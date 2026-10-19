import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const cliPath = join(projectDir, "cli.mjs");
const fixtureQuestDir = join(projectDir, "fixtures", "quests");

function runCli(t, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    const timer = setTimeout(() => child.kill(), 15_000);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function copyFixtures(t) {
  const root = await mkdtemp(join(tmpdir(), "quest-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const questDir = join(root, "quests");
  await cp(fixtureQuestDir, questDir, { recursive: true });
  return questDir;
}

function parseJson(result) {
  assert.equal(result.stderr, "", result.stderr);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`CLI did not return JSON (exit ${result.code}): ${result.stdout}\n${error.message}`);
  }
}

test("list and show return machine-readable quest data", async t => {
  const questDir = await copyFixtures(t);
  const list = await runCli(t, ["list", "--data-dir", questDir, "--json", "--brief"]);
  assert.equal(list.code, 0);
  const payload = parseJson(list);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, "list");
  assert.equal(payload.locale, "en_us");
  assert.equal(payload.quests.length, 2);
  assert.equal(payload.quests[0].id, "demo_first");

  const show = await runCli(t, ["show", "demo_first", "--data-dir", questDir, "--json"]);
  assert.equal(show.code, 0);
  const shown = parseJson(show);
  assert.equal(shown.quest.title, "First steps");
  assert.equal(shown.quest.subtitle, "A subtitle from the locale file");
  assert.equal(shown.quest.raw, undefined);

  const deps = await runCli(t, ["deps", "demo_first", "--data-dir", questDir, "--json", "--direction", "down"]);
  assert.equal(deps.code, 0);
  const related = parseJson(deps);
  assert.equal(related.dependants[0].id, "demo_second");
});

test("lint and schema expose diagnostics and the field model", async t => {
  const questDir = await copyFixtures(t);
  const lint = await runCli(t, ["lint", "--data-dir", questDir, "--json", "--strict"]);
  assert.equal(lint.code, 0);
  const reported = parseJson(lint);
  assert.deepEqual(reported.summary, { error: 0, warning: 0, info: 0 });

  const schema = await runCli(t, ["schema", "patch", "--json"]);
  assert.equal(schema.code, 0);
  const model = parseJson(schema);
  assert.equal(model.section, "patch");
  assert.ok(model.schema.fields.some(field => field.name === "description"));

  const skill = await runCli(t, ["skill", "--json"]);
  assert.equal(skill.code, 0);
  const guide = parseJson(skill);
  assert.match(guide.content, /^---\nname: ftbquests/m);
  assert.match(guide.content, /ftbquest patch/);

  const skillTarget = join(questDir, "..", "skill-target");
  const installed = await runCli(t, ["install-skill", "--target", skillTarget, "--json"]);
  assert.equal(installed.code, 0);
  assert.match(await readFile(join(skillTarget, "ftbquests", "SKILL.md"), "utf8"), /^---\nname: ftbquests/m);
});

test("patch defaults to dry-run, writes on --apply, and is idempotent", async t => {
  const questDir = await copyFixtures(t);
  const patchPath = join(questDir, "..", "patch.json");
  const chapterPath = join(questDir, "chapters", "demo-a.snbt");
  const before = await readFile(chapterPath, "utf8");
  await writeFile(patchPath, JSON.stringify({
    locale: "en_us",
    edits: [{ questId: "demo_first", x: 1.5, y: -1, title: "CLI edited" }],
  }));

  const dry = await runCli(t, ["patch", "--data-dir", questDir, "--file", patchPath, "--json"]);
  assert.equal(dry.code, 0);
  const dryPayload = parseJson(dry);
  assert.equal(dryPayload.dryRun, true);
  assert.equal(dryPayload.applied, false);
  assert.equal(dryPayload.changes.length, 2);
  assert.deepEqual(dryPayload.changes.map(change => change.path).sort(), ["chapters/demo-a.snbt", "lang/en_us.snbt"]);
  assert.ok(dryPayload.changes[0].hunks.length > 0);
  assert.equal(await readFile(chapterPath, "utf8"), before);

  const applied = await runCli(t, ["patch", "--data-dir", questDir, "--file", patchPath, "--apply", "--json"]);
  assert.equal(applied.code, 0);
  const appliedPayload = parseJson(applied);
  assert.equal(appliedPayload.applied, true);
  assert.equal(appliedPayload.backups.length, 1);
  assert.match(await readFile(chapterPath, "utf8"), /x: 1\.5/);

  const repeat = await runCli(t, ["patch", "--data-dir", questDir, "--file", patchPath, "--apply", "--json"]);
  assert.equal(repeat.code, 0);
  const repeatPayload = parseJson(repeat);
  assert.equal(repeatPayload.unchanged, true);
  assert.equal(repeatPayload.applied, false);
  assert.deepEqual(repeatPayload.backups, []);
  assert.equal((await readdir(join(questDir, ".quest-preview-backups"))).length, 1);
});

test("patch locale selects the target locale without --locale", async t => {
  const questDir = await copyFixtures(t);
  const patchPath = join(questDir, "..", "zh-patch.json");
  await writeFile(patchPath, JSON.stringify({
    locale: "zh_cn",
    edits: [{ questId: "demo_first", title: "CLI 中文标题" }],
  }));
  const result = await runCli(t, ["patch", "--data-dir", questDir, "--file", patchPath, "--apply", "--json"]);
  assert.equal(result.code, 0);
  const payload = parseJson(result);
  assert.equal(payload.locale, "zh_cn");
  assert.match(await readFile(join(questDir, "lang", "zh_cn.snbt"), "utf8"), /"quest\.demo_first\.title": "CLI 中文标题"/);
  assert.doesNotMatch(await readFile(join(questDir, "lang", "en_us.snbt"), "utf8"), /CLI 中文标题/);
});

test("invalid patches and usage errors return JSON with a non-zero exit", async t => {
  const questDir = await copyFixtures(t);
  const patchPath = join(questDir, "..", "bad-patch.json");
  await writeFile(patchPath, JSON.stringify({ edits: [{ questId: "demo_first", bogus: true }] }));
  const bad = await runCli(t, ["patch", "--data-dir", questDir, "--file", patchPath, "--json"]);
  assert.equal(bad.code, 1);
  const payload = parseJson(bad);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "invalid_patch");
  assert.match(payload.error.path, /edits\[0\]\.bogus/);

  const usage = await runCli(t, ["list", "--nope", "--json"]);
  assert.equal(usage.code, 2);
  const usagePayload = parseJson(usage);
  assert.equal(usagePayload.error.code, "usage");
});
