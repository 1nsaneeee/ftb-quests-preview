import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { plainText, renderFormattedText, drawFormattedText } from "../lib/formatted-text.js";
import { QuestNavigation } from "../components/quest-navigation.js";

test("navigation renders title color codes and keeps editor source separate", () => {
  const dom = new JSDOM('<div id="nav"></div><input id="search">');
  globalThis.document = dom.window.document;
  try {
    const quest = { id: "q", title: "&c挖矿要诀", tasks: [] };
    const navigation = new QuestNavigation({ root: document.querySelector("#nav"), search: document.querySelector("#search"), getAsset: () => null, onSelect() {} });
    navigation.mount();
    navigation.update({ chapterGroups: [], chapters: [{ id: "c", title: "Chapter", quests: [quest] }] }, "q");
    const title = document.querySelector(".quest-row-title");
    assert.equal(title.textContent, "挖矿要诀");
    assert.equal(title.firstChild.style.color, "rgb(255, 85, 85)");
    assert.equal(title.firstChild.childNodes.length, 1, "a style run is a single accessible text node");
    assert.equal(quest.title, "&c挖矿要诀");
    const target = document.createElement("div");
    renderFormattedText(target, '{"text":"<img src=x onerror=alert(1)>","bold":true}');
    assert.equal(target.querySelector("img"), null);
    assert.equal(target.textContent, "<img src=x onerror=alert(1)>");
    navigation.destroy();
  } finally { dom.window.close(); delete globalThis.document; }
});

test("canvas title renderer draws formatted glyphs instead of literal codes", () => {
  const drawn = [];
  const context = { save() {}, restore() {}, measureText: () => ({ width: 10 }), fillRect() {},
    fillText(text) { drawn.push({ text, color: this.fillStyle, font: this.font }); } };
  drawFormattedText(context, "&c挖矿&l要诀", 0, 0);
  assert.equal(drawn.map(run => run.text).join(""), "挖矿要诀");
  assert.equal(drawn[0].color, "#ff5555");
  assert.match(drawn[2].font, /bold/);
  assert.equal(plainText("§b你好"), "你好");
});
