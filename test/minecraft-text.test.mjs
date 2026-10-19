import test from "node:test";
import assert from "node:assert/strict";
import { splitPages, tokenizeFormatting } from "../lib/minecraft-text.js";

test("page breaks follow FTB Quests description page-index semantics", () => {
  assert.deepEqual(splitPages("A\n{@pagebreak}\nB"), [["A"], ["B"]]);
  assert.deepEqual(splitPages("A\n{@pagebreak}"), [["A"]]);
  assert.deepEqual(splitPages("A\n{@pagebreak}\n"), [["A"], [""]]);
  assert.deepEqual(splitPages("A\n{@pagebreak}\n{@pagebreak}\nB"), [["A"], [], ["B"]]);
  assert.deepEqual(splitPages("{@pagebreak}\nA"), [[], ["A"]]);
  assert.deepEqual(splitPages("{@pagebreak}"), [[]]);
});

test("hex formatting tokens retain the leading hash in CSS color values", () => {
  assert.deepEqual(tokenizeFormatting("&#ff8800X"), [
    { character: "X", style: { color: "#ff8800", bold: false, italic: false, underline: false, strike: false, obfuscated: false } },
  ]);
});
