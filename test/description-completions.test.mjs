import assert from "node:assert/strict";
import test from "node:test";
import { CompletionContext, autocompletion, hasNextSnippetField, nextSnippetField } from "@codemirror/autocomplete";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { descriptionCompletionSource } from "../lib/description-completions.js";

function completeAt(text, position = text.length, explicit = false) {
  const state = EditorState.create({
    doc: text,
    selection: { anchor: position },
    extensions: [autocompletion({ defaultKeymap: false }), history()],
  });
  const result = descriptionCompletionSource(new CompletionContext(state, position, explicit));
  return { state, result };
}

function applyOption(state, result, label, position = state.selection.main.head) {
  const option = result.options.find(candidate => candidate.label === label);
  assert.ok(option, `completion ${label} should be available`);
  let nextState = state;
  const editor = {
    get state() { return nextState; },
    dispatch(transaction) { nextState = nextState.update(transaction).state; },
  };
  if (typeof option.apply === "function") {
    option.apply(editor, option, result.from, position);
  } else {
    const insert = typeof option.apply === "string" ? option.apply : option.label;
    editor.dispatch({ changes: { from: result.from, to: position, insert } });
  }
  return nextState;
}

test("format completions preserve the typed marker and offer only renderer-supported codes", () => {
  const ampersand = completeAt("文字 &");
  assert.deepEqual(ampersand.result.options.map(option => option.label), [
    ..."0123456789abcdef".split("").map(code => `&${code}`),
    "&k", "&l", "&m", "&n", "&o", "&r",
  ]);
  const section = completeAt("§r");
  assert.ok(section.result.options.some(option => option.label === "§r"));
  assert.equal(section.result.options.some(option => option.label.includes("#")), false);
});

test("plain-language aliases insert format tokens without deleting adjacent text", () => {
  const { state, result } = completeAt("go!", 2);
  assert.equal(result.from, 0);
  const updated = applyOption(state, result, "gold", 2);
  assert.equal(updated.doc.toString(), "&6! ".trimEnd());
});

test("page break completion creates an unindented standalone line and preserves neighboring prose", () => {
  const { state, result } = completeAt("before {@pa after", 11);
  assert.ok(result.options.some(option => option.label === "{@pagebreak}"));
  const updated = applyOption(state, result, "{@pagebreak}", 11);
  assert.equal(updated.doc.toString(), "before \n{@pagebreak}\n after");

  const indented = completeAt("    {", 5);
  const unindented = applyOption(indented.state, indented.result, "{@pagebreak}", 5);
  assert.equal(unindented.doc.toString(), "{@pagebreak}");
});

test("image completion uses the previewer's field order and leaves a real resource placeholder", () => {
  const { state, result } = completeAt("img", 3);
  const image = result.options.find(option => option.label === "img");
  assert.ok(image);
  const inserted = applyOption(state, result, "img", 3);
  assert.equal(inserted.doc.toString(), "{image:resource_id width:96 height:64 align:center}");
  assert.equal(inserted.doc.sliceString(inserted.selection.main.from, inserted.selection.main.to), "resource_id");
  assert.equal(hasNextSnippetField(inserted), true);
  let next = inserted;
  nextSnippetField({ state: next, dispatch(transaction) { next = next.update(transaction).state; } });
  assert.equal(next.doc.sliceString(next.selection.main.from, next.selection.main.to), "96");
});

test("one snippet completion is one undoable and redoable CodeMirror transaction", () => {
  const { state, result } = completeAt("img", 3);
  let current = applyOption(state, result, "img", 3);
  assert.equal(undoDepth(current), 1);
  assert.equal(current.doc.toString(), "{image:resource_id width:96 height:64 align:center}");
  const editor = {
    get state() { return current; },
    dispatch(transaction) { current = current.update(transaction).state; },
  };
  undo(editor);
  assert.equal(current.doc.toString(), "img");
  redo(editor);
  assert.equal(current.doc.toString(), "{image:resource_id width:96 height:64 align:center}");
});

test("completion offsets use CodeMirror UTF-16 positions after CJK and emoji", () => {
  const text = "中文🙂 bold!";
  const position = text.indexOf(" bold") + 5;
  const { result } = completeAt(text, position);
  assert.equal(result.from, text.indexOf("bold"));
  assert.ok(result.options.some(option => option.label === "bold"));
});

test("completion source stays silent while IME composition is active", () => {
  const state = EditorState.create({ doc: "&" });
  const context = new CompletionContext(state, 1, false, { composing: true });
  assert.equal(descriptionCompletionSource(context), null);
});
