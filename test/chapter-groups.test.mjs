import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChapterGroups } from "../server/chapter-groups.mjs";

test("reads chapter groups in source order and resolves localized titles", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-groups-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "chapter_groups.snbt"), `[
    { id: "second" title: "Inline second" }
    { id: "first" title: "Inline first" }
    { id: "fallback" }
    { id: "inline" title: "Inline" }
    { title: "Missing ID" }
  ]`);
  const groups = await readChapterGroups({
    questDir: root,
    localeStrings: { "chapter_group.first.title": "第一组" },
    fallbackStrings: { "chapter_group.second.title": "Second group", "chapter_group.fallback.title": "Fallback group" },
  });
  assert.deepEqual(groups, [
    { id: "second", title: "Second group" },
    { id: "first", title: "第一组" },
    { id: "fallback", title: "Fallback group" },
    { id: "inline", title: "Inline" },
  ]);
});

test("accepts the chapter_groups compound and returns an empty list when absent", async t => {
  const root = await mkdtemp(join(tmpdir(), "quest-groups-compound-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await readChapterGroups({ questDir: root }), []);
  await writeFile(join(root, "chapter_groups.snbt"), `{ chapter_groups: [{ id: "group-a" }] }`);
  assert.deepEqual(await readChapterGroups({ questDir: root }), [{ id: "group-a", title: "group-a" }]);
});
