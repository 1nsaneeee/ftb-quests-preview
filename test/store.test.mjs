import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { QuestStore } from "../server/store.mjs";
import { saveQuestChanges } from "../server/save-service.mjs";
import { diffLines } from "../server/diff.mjs";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const fixtureQuestDir = join(projectDir, "fixtures", "quests");

async function copyFixtures(t) {
  const root = await mkdtemp(join(tmpdir(), "quest-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const questDir = join(root, "quests");
  await cp(fixtureQuestDir, questDir, { recursive: true });
  return questDir;
}

test("loads localized quests, chapter groups, revisions, and search", async () => {
  const store = await QuestStore.load({ questDir: fixtureQuestDir, locale: "zh_cn" });
  assert.equal(store.locale, "zh_cn");
  assert.deepEqual(store.locales, ["en_us", "zh_cn"]);
  assert.equal(store.chapters[0].title, "演示：开始");
  assert.equal(store.chapterGroups[0].title, "演示分组");
  const quest = store.showQuest("demo_first");
  assert.equal(quest.title, "第一步");
  assert.equal(quest.subtitle, "来自语言文件的副标题");
  assert.deepEqual(quest.description, ["A synthetic quest for trying the preview.", "No Minecraft files are bundled."]);
  assert.equal(quest.titleSource, "locale");
  assert.ok(quest.line > 0);
  assert.match(store.revisions["chapters/demo-a.snbt"], /^[a-f0-9]{64}$/);
  assert.match(store.revisions["lang/zh_cn.snbt"], /^[a-f0-9]{64}$/);
  assert.equal(store.search("副标题")[0].id, "demo_first");
  assert.equal(store.search("demo_first", { fields: ["id"] })[0].id, "demo_first");
  assert.equal(store.related("demo_first", { direction: "down" }).dependants[0].id, "demo_second");
  assert.deepEqual(store.related("demo_second", { direction: "up" }).dependencies.map(item => item.id), ["demo_first"]);
  assert.equal(store.related("missing"), null);
  assert.deepEqual(store.lint().summary, { error: 0, warning: 0, info: 0 });
});

test("lint reports structural breakage without throwing", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-lint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const questDir = join(root, "quests");
  await mkdir(join(questDir, "chapters"), { recursive: true });
  await writeFile(join(questDir, "chapters", "bad.snbt"), `{
    id: "bad"
    group: "missing_group"
    quests: [
      { id: "q1" title: "Q1" x: 0 y: 0 shape: "triangle" dependencies: ["missing"]
        tasks: [{ id: "t1" type: "item" }, { id: "t2" }]
        rewards: [{ id: "r1" type: "unknown_reward" }] }
      { id: "q2" title: "Q2" x: 0 y: 0 dependencies: ["q3"] }
      { id: "q3" title: "Q3" x: 1 y: 0 dependencies: ["q2"] }
      { id: "q2" title: "Q2 duplicate" x: 2 y: 2 }
      { x: 3 y: 3 }
    ]
  }`);
  const store = await QuestStore.load({ questDir });
  const result = store.lint();
  const codes = new Set(result.issues.map(item => item.code));
  for (const code of [
    "missing-chapter-group", "unknown-shape", "missing-dependency", "missing-task-type",
    "unknown-reward-type", "dependency-cycle", "duplicate-quest-id", "duplicate-coordinate",
    "missing-quest-id",
  ]) {
    assert.ok(codes.has(code), `expected lint code ${code}; got ${[...codes].join(", ")}`);
  }
  const cycle = result.issues.find(item => item.code === "dependency-cycle");
  assert.ok(cycle.path.includes("q2") && cycle.path.includes("q3"));
  assert.equal(result.strictFailed, true);
  assert.ok(result.summary.error > 0);
});

test("dry-run reports hunks without writing; apply is idempotent and backs up", async t => {
  const questDir = await copyFixtures(t);
  const chapterPath = join(questDir, "chapters", "demo-a.snbt");
  const localePath = join(questDir, "lang", "en_us.snbt");
  const chapterBefore = await readFile(chapterPath);
  const localeBefore = await readFile(localePath);
  const store = await QuestStore.load({ questDir, locale: "en_us" });
  const changes = [{
    questId: "demo_first",
    x: 1.5,
    y: -1,
    title: "CLI edited",
    subtitle: "CLI subtitle",
    description: ["line one", "line two"],
  }];
  const args = {
    questDir,
    chapterDir: join(questDir, "chapters"),
    localeDir: join(questDir, "lang"),
    locale: "en_us",
    locales: store.locales,
    revisions: store.revisions,
    changes,
  };

  const dry = await saveQuestChanges({ ...args, dryRun: true });
  assert.equal(dry.unchanged, false);
  assert.deepEqual(dry.backups, []);
  assert.equal(dry.changes.length, 2);
  assert.ok(dry.changes[0].hunks.length > 0);
  assert.deepEqual(await readFile(chapterPath), chapterBefore);
  assert.deepEqual(await readFile(localePath), localeBefore);
  await assert.rejects(readdir(join(questDir, ".quest-preview-backups")));

  const applied = await saveQuestChanges({ ...args, dryRun: false });
  assert.equal(applied.unchanged, false);
  assert.equal(applied.backups.length, 1);
  const updatedChapter = await readFile(chapterPath, "utf8");
  assert.match(updatedChapter, /x: 1\.5/);
  assert.match(await readFile(localePath, "utf8"), /"quest\.demo_first\.title": "CLI edited"/);

  const reloaded = await QuestStore.load({ questDir, locale: "en_us" });
  const repeat = await saveQuestChanges({
    ...args,
    revisions: reloaded.revisions,
    changes,
  });
  assert.equal(repeat.unchanged, true);
  assert.deepEqual(repeat.backups, []);
  assert.equal((await readdir(join(questDir, ".quest-preview-backups"))).length, 1);
});

test("stale revisions report the file and both hashes", async t => {
  const questDir = await copyFixtures(t);
  const store = await QuestStore.load({ questDir, locale: "en_us" });
  const stale = { ...store.revisions, "chapters/demo-a.snbt": "0".repeat(64) };
  await assert.rejects(saveQuestChanges({
    questDir,
    chapterDir: join(questDir, "chapters"),
    localeDir: join(questDir, "lang"),
    locale: "en_us",
    locales: store.locales,
    revisions: stale,
    changes: [{ questId: "demo_first", x: 1 }],
    dryRun: true,
  }), error => {
    assert.equal(error.code, "REVISION_CONFLICT");
    assert.equal(error.relativePath, "chapters/demo-a.snbt");
    assert.equal(error.expectedRevision, "0".repeat(64));
    assert.match(error.actualRevision, /^[a-f0-9]{64}$/);
    return true;
  });
});

test("diffLines returns context hunks and detects identical input", () => {
  const before = "one\ntwo\nthree\nfour\nfive\n";
  const after = "one\nTWO\nthree\nfour\nfive\n";
  const diff = diffLines(before, after, 1);
  assert.equal(diff.truncated, false);
  assert.equal(diff.hunks.length, 1);
  assert.ok(diff.hunks[0].lines.includes("-two"));
  assert.ok(diff.hunks[0].lines.includes("+TWO"));
  assert.deepEqual(diffLines(before, before).hunks, []);
});
