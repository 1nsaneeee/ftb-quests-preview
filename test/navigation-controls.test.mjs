import test from "node:test";
import assert from "node:assert/strict";
import { QuestNavigation } from "../components/quest-navigation.js";
import { normalizeWidth, widthBoundsFor } from "../components/preview-controls.js";

test("navigation keeps declared group order and source chapter order", () => {
  const navigation = new QuestNavigation({ root: {}, search: {}, getAsset: () => null, onSelect() {} });
  navigation.data = {
    chapterGroups: [{ id: "b", title: "B" }, { id: "a", title: "A" }, { id: "empty", title: "Empty" }],
    chapters: [
      { id: "a-2", group: "a", quests: [] },
      { id: "b-1", group: "b", quests: [] },
      { id: "missing", group: "unknown", quests: [] },
      { id: "a-1", group: "a", quests: [] },
      { id: "none", group: null, quests: [] },
    ],
  };
  assert.deepEqual(navigation.groups().map(group => [group.id, group.title, group.chapters.map(chapter => chapter.id)]), [
    ["b", "B", ["b-1"]],
    ["a", "A", ["a-2", "a-1"]],
    ["empty", "Empty", []],
    ["__unassigned__", "未分组", ["missing", "none"]],
  ]);
});

test("width controls keep dynamic range endpoints reachable at four-pixel steps", () => {
  const bounds = widthBoundsFor(182);
  assert.deepEqual(bounds, { min: 182, max: 638 });
  assert.equal(normalizeWidth(220, bounds), 222);
  assert.equal(normalizeWidth(250, bounds), 250);
  assert.equal(normalizeWidth(999, bounds), 638);
  assert.equal(normalizeWidth(1, bounds), 182);
});

test("width control remains reachable when quest minimum exceeds the default maximum", () => {
  const bounds = widthBoundsFor(700);
  assert.deepEqual(bounds, { min: 700, max: 700 });
  assert.equal(normalizeWidth(220, bounds), 700);
});
