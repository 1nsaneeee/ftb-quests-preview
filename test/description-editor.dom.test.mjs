import assert from "node:assert/strict";
import test, { before } from "node:test";
import { JSDOM } from "jsdom";

let win;
let document;
let DescriptionEditor;
let autocomplete;

before(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  win = dom.window;
  document = win.document;
  globalThis.window = win;
  globalThis.document = document;
  globalThis.MutationObserver = win.MutationObserver;
  globalThis.Range = win.Range;
  globalThis.Window = win.Window;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Node = win.Node;

  const zeroRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });
  const rectList = () => {
    const rect = zeroRect();
    return { length: 1, 0: rect, item: () => rect, [Symbol.iterator]: function* () { yield rect; } };
  };
  win.Range.prototype.getClientRects = rectList;
  win.Range.prototype.getBoundingClientRect = zeroRect;
  win.Element.prototype.getClientRects = rectList;
  win.HTMLElement.prototype.getBoundingClientRect = zeroRect;

  ({ DescriptionEditor } = await import("../components/description-editor.js"));
  autocomplete = await import("@codemirror/autocomplete");
});

function createEditor({ doc = "", editable = true } = {}) {
  const workbench = document.createElement("div");
  const pane = document.createElement("section");
  const divider = document.createElement("div");
  const host = document.createElement("div");
  workbench.append(pane, divider, host);
  document.body.append(workbench);
  const messages = [];
  const saves = [];
  const editor = new DescriptionEditor({ host, divider, pane, workbench }, {
    change: text => messages.push(text),
    save: () => saves.push(Date.now()),
  });
  editor.mount();
  editor.update({ questKey: "first", doc, editable });
  const view = editor.ensureView();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  return { editor, view, messages, saves, elements: { workbench, pane, divider, host } };
}

const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40, PageUp: 33, PageDown: 34 };

function key(view, keyName, init = {}) {
  const shifted = keyName.startsWith("Shift-");
  const base = shifted ? keyName.slice(6) : keyName;
  const event = new win.KeyboardEvent("keydown", {
    key: base,
    keyCode: KEY_CODES[base] ?? base.toUpperCase().charCodeAt(0),
    shiftKey: shifted,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

function selectedText(view) {
  const selection = view.state.selection.main;
  return view.state.sliceDoc(selection.from, selection.to);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function openCompletion(view, { select = 0 } = {}) {
  autocomplete.startCompletion(view);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(20);
    if (autocomplete.completionStatus(view.state) === "active") break;
  }
  assert.equal(autocomplete.completionStatus(view.state), "active");
  await sleep(100);
  for (let index = 0; index < select; index += 1) key(view, "ArrowDown");
}

test("Tab accepts an active completion inside the real editor DOM", async () => {
  const { editor, view } = createEditor({ doc: "&" });
  try {
    await openCompletion(view);
    const event = key(view, "Tab");
    assert.equal(event.defaultPrevented, true);
    assert.equal(view.state.doc.toString(), "&0");
  } finally {
    editor.destroy();
  }
});

test("Tab and Shift-Tab walk snippet fields, Escape clears them", async () => {
  const { editor, view } = createEditor({ doc: "img" });
  try {
    await openCompletion(view, { select: 4 });
    key(view, "Tab");
    assert.equal(view.state.doc.toString(), "{image:resource_id width:96 height:64 align:center}");
    assert.equal(selectedText(view), "resource_id");

    key(view, "Tab");
    assert.equal(selectedText(view), "96");

    key(view, "Shift-Tab", { shiftKey: true });
    assert.equal(selectedText(view), "resource_id");

    key(view, "Escape");
    assert.equal(autocomplete.hasNextSnippetField(view.state), false);
    assert.equal(autocomplete.hasPrevSnippetField(view.state), false);
  } finally {
    editor.destroy();
  }
});

test("Enter remains a newline key when no completion is open", () => {
  const { editor, view } = createEditor({ doc: "abc" });
  try {
    key(view, "Enter");
    assert.equal(view.state.doc.toString(), "abc\n");
  } finally {
    editor.destroy();
  }
});

test("Tab leaves browser focus navigation alone without a completion or snippet", () => {
  const { editor, view } = createEditor({ doc: "abc" });
  try {
    const event = key(view, "Tab");
    assert.equal(event.defaultPrevented, false);
  } finally {
    editor.destroy();
  }
});

test("editing reports the document once per change", () => {
  const { editor, view, messages } = createEditor({ doc: "abc" });
  try {
    view.dispatch({ changes: { from: 0, insert: "X" } });
    assert.deepEqual(messages, ["Xabc"]);
  } finally {
    editor.destroy();
  }
});

test("switching quests preserves each task's selection and isolated undo history", () => {
  const { editor, view } = createEditor({ doc: "one" });
  try {
    view.dispatch({ changes: { from: 3, insert: "2" } });
    assert.equal(view.state.doc.toString(), "one2");
    view.dispatch({ selection: { anchor: 1, head: 3 } });

    editor.update({ questKey: "second", doc: "two", editable: true });
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "two");

    editor.update({ questKey: "first", doc: "one2", editable: true });
    assert.equal(selectedText(view), "ne");
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "one");
  } finally {
    editor.destroy();
  }
});

test("format shortcuts preserve selection and are one undo step", () => {
  const { editor, view } = createEditor({ doc: "中文重点结尾" });
  try {
    view.dispatch({ selection: { anchor: 2, head: 4 } });
    assert.equal(key(view, "b", { ctrlKey: true }).defaultPrevented, true);
    assert.equal(view.state.doc.toString(), "中文&l重点&r结尾");
    assert.equal(selectedText(view), "重点");
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "中文重点结尾");
    view.dispatch({ selection: { anchor: 0 } });
    key(view, "u", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "&n&r中文重点结尾");
    assert.equal(view.state.selection.main.head, 2);
  } finally { editor.destroy(); }
});

test("link action escapes JSON and snippet punctuation and preserves adjacent prose", () => {
  const label = '说明 "A" \\ ${1:字段}';
  const { editor, view } = createEditor({ doc: `前${label}后` });
  try {
    view.dispatch({ selection: { anchor: 1, head: 1 + label.length } });
    editor.runAction("link");
    const lines = view.state.doc.toString().split("\n");
    assert.equal(lines[0], "前");
    assert.equal(lines[2], "后");
    const component = JSON.parse(lines[1]);
    assert.equal(component.text, label);
    assert.equal(component.clickEvent.action, "open_url");
    assert.equal(selectedText(view), "https://example.com");
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), `前${label}后`);
  } finally { editor.destroy(); }
});

test("search panel replaces only the active task and the replacement is undoable", async () => {
  const { editor, view } = createEditor({ doc: "土粒 土粒 中子" });
  const search = await import("@codemirror/search");
  try {
    key(view, "f", { ctrlKey: true });
    assert.ok(editor.host.querySelector('input[aria-label="查找正文"]'));
    view.dispatch({ effects: search.setSearchQuery.of(new search.SearchQuery({ search: "土粒", replace: "粉尘" })) });
    assert.equal(search.replaceAll(view), true);
    assert.equal(view.state.doc.toString(), "粉尘 粉尘 中子");
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "土粒 土粒 中子");
    editor.update({ questKey: "second", doc: "土粒", editable: true });
    assert.equal(view.state.doc.toString(), "土粒");
  } finally { editor.destroy(); }
});

test("reload and explicit discard clear stale history without echoing changes", () => {
  const { editor, view, messages } = createEditor({ doc: "old" });
  try {
    view.dispatch({ changes: { from: 3, insert: " draft" } });
    editor.update({ questKey: "first", doc: "disk", editable: true });
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "disk");
    assert.deepEqual(messages, ["old draft"]);
    view.dispatch({ changes: { from: 4, insert: " new" } });
    editor.update({ questKey: "second", doc: "two", editable: true });
    editor.resetHistory("first");
    editor.update({ questKey: "first", doc: "disk new", editable: true });
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "disk new");
  } finally { editor.destroy(); }
});

test("saving blocks format, undo and replace after switching tasks too", async () => {
  const { editor, view } = createEditor({ doc: "one" });
  const search = await import("@codemirror/search");
  try {
    view.dispatch({ changes: { from: 3, insert: " draft" } });
    editor.update({ questKey: "second", doc: "two", editable: false });
    editor.update({ questKey: "first", doc: "one draft", editable: false });
    key(view, "b", { ctrlKey: true });
    key(view, "z", { ctrlKey: true });
    editor.runAction("link");
    view.dispatch({ effects: search.setSearchQuery.of(new search.SearchQuery({ search: "one", replace: "changed" })) });
    search.replaceAll(view);
    assert.equal(view.state.doc.toString(), "one draft");
    assert.equal(view.contentDOM.getAttribute("contenteditable"), "false");
  } finally { editor.destroy(); }
});

test("paired braces are consumed by completion instead of producing an extra brace", async () => {
  const { editor, view } = createEditor({ doc: "" });
  try {
    view.dispatch(autocomplete.insertBracket(view.state, "{"));
    assert.equal(view.state.doc.toString(), "{}");
    assert.equal(view.state.selection.main.head, 1);
    await openCompletion(view);
    const options = autocomplete.currentCompletions(view.state);
    const index = options.findIndex(option => option.label === "{@pagebreak}");
    assert.ok(index >= 0);
    view.dispatch({ effects: autocomplete.setSelectedCompletion(index) });
    key(view, "Tab");
    assert.equal(view.state.doc.toString(), "{@pagebreak}");
  } finally { editor.destroy(); }
});

test("external document updates do not echo back as user edits", () => {
  const { editor, view, messages } = createEditor({ doc: "abc" });
  try {
    editor.update({ questKey: "first", doc: "rewritten", editable: true });
    assert.equal(view.state.doc.toString(), "rewritten");
    assert.deepEqual(messages, []);
  } finally {
    editor.destroy();
  }
});

test("Ctrl+S invokes the save handler and prevents the browser Save Page shortcut", () => {
  const { editor, view, saves } = createEditor({ doc: "abc" });
  try {
    const event = key(view, "s", { ctrlKey: true });
    assert.equal(event.defaultPrevented, true);
    assert.equal(saves.length, 1);
  } finally {
    editor.destroy();
  }
});

test("saving disables editing through the editable compartment", () => {
  const { editor, view } = createEditor({ doc: "abc" });
  try {
    editor.update({ questKey: "first", doc: "abc", editable: false });
    assert.equal(view.contentDOM.getAttribute("contenteditable"), "false");
    editor.update({ questKey: "first", doc: "abc", editable: true });
    assert.equal(view.contentDOM.getAttribute("contenteditable"), "true");
  } finally {
    editor.destroy();
  }
});
