import test from "node:test";
import assert from "node:assert/strict";
import { parseSnbt } from "../parse-snbt.mjs";
import { parseSnbtDocument, patchLocaleSnbt, patchQuestSnbt } from "../server/snbt-edit.mjs";

test("parses FTB style compounds, namespaced values, lists, and numeric suffixes", () => {
  const result = parseSnbt('{ id: "quest" icon: { id: minecraft:book } x: -0.5d tasks: [{ type: checkmark }] }');
  assert.equal(result.id, "quest");
  assert.equal(result.icon.id, "minecraft:book");
  assert.equal(result.x, -0.5);
  assert.equal(result.tasks[0].type, "checkmark");
});

test("reports duplicate keys with the supplied source label", () => {
  assert.throws(
    () => parseSnbt("{ id: one id: two }", "chapter.snbt"),
    /chapter\.snbt:1:\d+: duplicate key 'id'/,
  );
});

test("keeps punctuation-only strings as scalar values", () => {
  const values = parseSnbt('{open: "{" close: "}" listOpen: "[" listClose: "]" colon: ":" quote: "\\\"" slash: "\\\\"}');
  assert.equal(values.open, "{");
  assert.equal(values.close, "}");
  assert.equal(values.listOpen, "[");
  assert.equal(values.listClose, "]");
  assert.equal(values.colon, ":");
  assert.equal(values.quote, '"');
  assert.equal(values.slash, "\\");
});

test("round-trips description punctuation, escapes, and omitted or trailing commas", () => {
  const lines = ["{", "}", "[", "]", ":", ",", '"', "\\", "&l###"];
  const source = '{ quest_desc: ["{", "}" "[", "]", ":", ",", "\\\"", "\\\\", "&l###",] }';
  assert.deepEqual(parseSnbt(source).quest_desc, lines);
  const patched = patchLocaleSnbt("{\n}\n", "punctuation", { quest_desc: lines });
  assert.deepEqual(parseSnbt(patched)["quest.punctuation.quest_desc"], lines);
});

test("patches only selected quest fields and keeps source bytes around them", () => {
  const source = '\uFEFF{\r\n\t# keep this comment\r\n\tquests: [\r\n\t\t{ id: "q" x: 1d unknown: [a, b] }\r\n\t]\r\n}\r\n';
  const document = parseSnbtDocument(source);
  assert.equal(document.kind, "compound");
  const patched = patchQuestSnbt(source, "q", { x: 2.5, y: -3 });
  assert.equal(patched.startsWith("\uFEFF"), true);
  assert.equal(patched.includes("\r\n"), true);
  assert.match(patched, /# keep this comment/);
  assert.match(patched, /x: 2\.5 unknown: \[a, b\]/);
  assert.match(patched, /"y": -3/);
  assert.match(patched, /unknown: \[a, b\]/);
});

test("patches selected locale keys and inserts missing keys into the root compound", () => {
  const source = '{\n  "quest.q.title": "old"\n  # preserve me\n}\n';
  const patched = patchLocaleSnbt(source, "q", { title: "new", subtitle: "sub", quest_desc: ["one", "two"] });
  assert.match(patched, /"quest\.q\.title": "new"/);
  assert.match(patched, /"quest\.q\.quest_subtitle": "sub"/);
  assert.match(patched, /"quest\.q\.quest_desc": \["one","two"\]/);
  assert.match(patched, /# preserve me/);
  assert.equal(patched.endsWith("\n"), true);
});
