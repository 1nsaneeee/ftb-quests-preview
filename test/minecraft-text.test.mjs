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

test("JSON text components render content, inherited styles, and safe links", () => {
  const source = JSON.stringify({ text: "打开", color: "aqua", underlined: true,
    clickEvent: { action: "open_url", value: "https://www.mcmod.cn" },
    extra: [{ text: "网页", bold: true }, { text: "!", underlined: false, color: "red" }] });
  const tokens = tokenizeFormatting(source);
  assert.equal(tokens.map(token => token.character).join(""), "打开网页!");
  assert.equal(tokens[0].style.color, "#55ffff");
  assert.equal(tokens[0].style.underline, true);
  assert.equal(tokens[2].style.bold, true);
  assert.equal(tokens[4].style.underline, false);
  assert.equal(tokens[4].style.color, "#ff5555");
  assert.equal(tokens[2].style.href, "https://www.mcmod.cn/");
  for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///secret", "//example.com"]) {
    const unsafe = tokenizeFormatting(JSON.stringify({ text: "link", clickEvent: { action: "open_url", value } }));
    assert.equal(unsafe[0].style.href, undefined);
  }
});

test("escaped JSON exports, multiline components, and literal malformed JSON stay readable", () => {
  const json = JSON.stringify({ text: 'line\n"quoted"', color: "#123456" });
  const escaped = JSON.stringify(json).slice(1, -1);
  for (const source of [json, escaped]) {
    assert.equal(tokenizeFormatting(source).map(token => token.character).join(""), 'line\n"quoted"');
    assert.equal(tokenizeFormatting(source)[0].style.color, "#123456");
  }
  for (const source of ['{"text": broken}', '{image:test:icon}', '{"unrelated":1}', '<script>hi</script>']) {
    assert.equal(tokenizeFormatting(source).map(token => token.character).join(""), source);
  }
});
