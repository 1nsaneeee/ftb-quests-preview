import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSetup, supportsNode } from "../install.mjs";
import { loadPreviewConfig } from "../server/config.mjs";

async function makeQuestDir(path) {
  await mkdir(join(path, "chapters"), { recursive: true });
}

test("setup runtime guard accepts Node 20+ and rejects unsupported versions", () => {
  assert.equal(supportsNode("20.0.0"), true);
  assert.equal(supportsNode("24.19.0"), true);
  assert.equal(supportsNode("18.20.8"), false);
  assert.equal(supportsNode("not-a-version"), false);
});

test("non-interactive setup writes a project-relative instance config", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-preview-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, "app");
  const instanceRoot = join(root, "instance");
  await makeQuestDir(join(instanceRoot, "config", "ftbquests", "quests"));

  const result = await runSetup({
    argv: ["--instance-root", "../instance"],
    cwd: projectDir,
    projectDirectory: projectDir,
    interactive: false,
  });
  const written = JSON.parse(await readFile(result.configPath, "utf8"));
  assert.deepEqual(written, { version: 1, mode: "instance", instanceRoot: "../instance" });
  const loaded = await loadPreviewConfig({
    argv: [], env: {}, cwd: projectDir, projectDir, fixtureQuestDir: join(projectDir, "fixtures", "quests"),
  });
  assert.equal(loaded.instanceRoot, resolve(instanceRoot));
  assert.equal(loaded.questDir, resolve(instanceRoot, "config", "ftbquests", "quests"));
});

test("setup requires explicit replacement and preserves the prior config in a backup", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-preview-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, "app");
  const instanceRoot = join(root, "instance");
  await makeQuestDir(join(instanceRoot, "config", "ftbquests", "quests"));
  await mkdir(projectDir, { recursive: true });
  const configPath = join(projectDir, "quest-preview.local.json");
  const original = "{\"version\":1,\"mode\":\"demo\"}\n";
  await writeFile(configPath, original);

  const base = { cwd: projectDir, projectDirectory: projectDir, interactive: false };
  await assert.rejects(runSetup({ ...base, argv: ["--instance-root", "../instance"] }), /already exists/);
  assert.equal(await readFile(configPath, "utf8"), original);

  const result = await runSetup({ ...base, argv: ["--instance-root", "../instance", "--replace"] });
  assert.ok(result.backupPath);
  assert.equal(await readFile(result.backupPath, "utf8"), original);
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).instanceRoot, "../instance");
  assert.ok((await readdir(projectDir)).some(name => name.includes(".bak-")));
});

test("setup can persist an explicit demo selection", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-preview-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, "app");
  const result = await runSetup({
    argv: ["--demo"], cwd: projectDir, projectDirectory: projectDir, interactive: false,
  });
  assert.deepEqual(JSON.parse(await readFile(result.configPath, "utf8")), { version: 1, mode: "demo" });
});
