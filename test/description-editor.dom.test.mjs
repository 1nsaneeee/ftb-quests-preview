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

test("switching quests replaces the state and keeps undo histories isolated", () => {
  const { editor, view } = createEditor({ doc: "one" });
  try {
    view.dispatch({ changes: { from: 3, insert: "2" } });
    assert.equal(view.state.doc.toString(), "one2");

    editor.update({ questKey: "second", doc: "two", editable: true });
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "two");

    editor.update({ questKey: "first", doc: "one2", editable: true });
    key(view, "z", { ctrlKey: true });
    assert.equal(view.state.doc.toString(), "one2");
  } finally {
    editor.destroy();
  }
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
