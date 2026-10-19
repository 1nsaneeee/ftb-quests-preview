import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  completionStatus,
  hasNextSnippetField,
  hasPrevSnippetField,
  moveCompletionSelection,
  nextSnippetField,
  prevSnippetField,
  startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, drawSelection, highlightSpecialChars, keymap, placeholder } from "@codemirror/view";
import { descriptionCompletionSource } from "../lib/description-completions.js";

const DIVIDER_STEP = 24;
const DIVIDER_LARGE_STEP = 96;
const MIN_EDITOR_HEIGHT = 120;
const MIN_PREVIEW_HEIGHT = 160;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "#d9dfda",
    backgroundColor: "#191d1c",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "var(--mono, 'Cascadia Code', Consolas, monospace)",
    lineHeight: "1.7",
    overflow: "auto",
  },
  ".cm-content": { padding: "10px 0", caretColor: "#f0d28b" },
  ".cm-line": { padding: "0 14px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "#f0d28b" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "#4b3f24",
  },
  ".cm-selectionMatch": { backgroundColor: "#3a3524" },
  ".cm-placeholder": { color: "#737d77" },
  ".cm-tooltip": {
    color: "#e5e9e5",
    backgroundColor: "#232727",
    border: "1px solid #4a524e",
    boxShadow: "0 8px 20px #0008",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--mono, monospace)" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "4px 10px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    color: "#fff4d7",
    backgroundColor: "#4b3f24",
  },
  ".cm-completionLabel": { fontSize: "12px" },
  ".cm-completionDetail": { marginLeft: "12px", color: "#a2aaa5", fontStyle: "normal" },
  ".cm-completionIcon": { opacity: ".8" },
  ".cm-snippetField": { backgroundColor: "#3a3524" },
  ".cm-snippetFieldPosition": { borderLeft: "2px solid #d8aa45" },
  ".cm-panels": { backgroundColor: "#232727", color: "#e5e9e5" },
});

function completionIsOpen(view) {
  return completionStatus(view.state) === "active";
}

function snippetIsActive(state) {
  return hasNextSnippetField(state) || hasPrevSnippetField(state);
}

export class DescriptionEditor {
  constructor({ host, divider, pane, workbench }, handlers) {
    this.host = host;
    this.divider = divider;
    this.pane = pane;
    this.workbench = workbench;
    this.handlers = handlers;
    this.view = null;
    this.extensions = null;
    this.questKey = "";
    this.lastDoc = null;
    this.editable = true;
    this.editableCompartment = new Compartment();
    this.drag = null;
    this.paneHeight = 0;
    this.boundPointerMove = event => this.onPointerMove(event);
    this.boundPointerUp = event => this.onPointerUp(event);
    this.boundPointerDown = event => this.onPointerDown(event);
    this.boundKeyDown = event => this.onDividerKeyDown(event);
    this.boundWindowResize = () => this.clampPaneHeight();
  }

  mount() {
    this.paneHeight = this.readPaneHeight();
    this.updateAria();
    this.divider.addEventListener("pointerdown", this.boundPointerDown);
    this.divider.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("resize", this.boundWindowResize);
  }

  ensureView() {
    if (this.view) return this.view;
    this.extensions = [
      history(),
      drawSelection(),
      highlightSpecialChars(),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      placeholder("输入任务说明：& 颜色 / 格式，{@pagebreak} 分页，Tab 接受补全"),
      autocompletion({
        override: [descriptionCompletionSource],
        defaultKeymap: false,
        activateOnTyping: true,
        maxRenderedOptions: 30,
        addToOptions: [{
          position: 10,
          render(completion) {
            if (!completion.color) return null;
            const swatch = document.createElement("span");
            swatch.className = "cm-completionSwatch";
            swatch.style.background = completion.color;
            swatch.setAttribute("aria-hidden", "true");
            return swatch;
          },
        }],
      }),
      keymap.of([
        { key: "Mod-s", run: () => { this.handlers.save(); return true; }, preventDefault: true },
        { key: "Tab", run: view => this.onTab(view) },
        { key: "Shift-Tab", run: view => this.onShiftTab(view) },
        { key: "Escape", run: view => this.onEscape(view) },
        { key: "ArrowDown", run: view => this.onArrow(view, true) },
        { key: "ArrowUp", run: view => this.onArrow(view, false) },
        { key: "PageDown", run: view => this.onArrow(view, true, "page") },
        { key: "PageUp", run: view => this.onArrow(view, false, "page") },
        { key: "Enter", run: view => completionIsOpen(view) ? acceptCompletion(view) : false },
      ]),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      this.editableCompartment.of(EditorView.editable.of(true)),
      editorTheme,
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        const text = update.state.doc.toString();
        if (text === this.lastDoc) return;
        this.lastDoc = text;
        this.handlers.change(text);
      }),
    ];
    this.view = new EditorView({
      state: EditorState.create({ doc: "", extensions: this.extensions }),
      parent: this.host,
    });
    return this.view;
  }

  onTab(view) {
    if (view.composing) return false;
    if (completionIsOpen(view)) return acceptCompletion(view);
    if (snippetIsActive(view.state)) return nextSnippetField(view);
    return false;
  }

  onShiftTab(view) {
    if (view.composing) return false;
    if (snippetIsActive(view.state)) return prevSnippetField(view);
    return false;
  }

  onEscape(view) {
    if (completionIsOpen(view)) return closeCompletion(view);
    if (snippetIsActive(view.state)) return clearSnippet(view);
    return false;
  }

  onArrow(view, forward, by = "option") {
    if (!completionIsOpen(view)) return false;
    return moveCompletionSelection(forward, by)(view);
  }

  showCompletions() {
    const view = this.ensureView();
    view.focus();
    startCompletion(view);
  }

  update({ questKey, doc, editable = true }) {
    const view = this.ensureView();
    if (questKey !== this.questKey) {
      this.questKey = questKey;
      this.lastDoc = doc;
      view.setState(EditorState.create({ doc, extensions: this.extensions }));
      this.setEditable(editable, view);
      return;
    }
    if (doc !== view.state.doc.toString()) {
      this.lastDoc = doc;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        annotations: Transaction.addToHistory.of(false),
      });
    }
    this.setEditable(editable, view);
  }

  setEditable(editable, view = this.ensureView()) {
    const next = Boolean(editable);
    if (next === this.editable) return;
    this.editable = next;
    view.dispatch({ effects: this.editableCompartment.reconfigure(EditorView.editable.of(next)) });
  }

  readPaneHeight() {
    return Math.max(MIN_EDITOR_HEIGHT, Math.round(this.pane.getBoundingClientRect().height));
  }

  availableHeight() {
    return Math.max(MIN_EDITOR_HEIGHT, Math.round(this.workbench.getBoundingClientRect().height));
  }

  maxPaneHeight() {
    return Math.max(MIN_EDITOR_HEIGHT, this.availableHeight() - MIN_PREVIEW_HEIGHT);
  }

  setPaneHeight(height) {
    const next = Math.round(Math.min(this.maxPaneHeight(), Math.max(MIN_EDITOR_HEIGHT, height)));
    this.paneHeight = next;
    this.pane.style.height = `${next}px`;
    this.updateAria();
  }

  clampPaneHeight() {
    if (!this.paneHeight) return;
    const clamped = Math.min(this.maxPaneHeight(), Math.max(MIN_EDITOR_HEIGHT, this.paneHeight));
    if (clamped !== this.paneHeight) this.setPaneHeight(clamped);
  }

  updateAria() {
    const max = this.pane ? this.maxPaneHeight() : MIN_EDITOR_HEIGHT;
    this.divider.setAttribute("aria-valuemin", String(MIN_EDITOR_HEIGHT));
    this.divider.setAttribute("aria-valuemax", String(max));
    this.divider.setAttribute("aria-valuenow", String(this.paneHeight));
    this.divider.setAttribute("aria-valuetext", `编辑区高度 ${this.paneHeight} 像素`);
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.divider.focus();
    this.drag = {
      startY: event.clientY,
      startHeight: this.readPaneHeight(),
      originalHeight: this.paneHeight,
      pointerId: event.pointerId,
    };
    this.paneHeight = this.drag.startHeight;
    document.body.classList.add("resizing-editor");
    document.addEventListener("pointermove", this.boundPointerMove);
    document.addEventListener("pointerup", this.boundPointerUp);
    document.addEventListener("pointercancel", this.boundPointerUp);
  }

  onPointerMove(event) {
    if (!this.drag) return;
    const delta = this.drag.startY - event.clientY;
    this.setPaneHeight(this.drag.startHeight + delta);
  }

  onPointerUp() {
    if (!this.drag) return;
    this.drag = null;
    document.body.classList.remove("resizing-editor");
    document.removeEventListener("pointermove", this.boundPointerMove);
    document.removeEventListener("pointerup", this.boundPointerUp);
    document.removeEventListener("pointercancel", this.boundPointerUp);
  }

  onDividerKeyDown(event) {
    if (event.key === "Escape" && this.drag) {
      event.preventDefault();
      this.setPaneHeight(this.drag.originalHeight);
      this.onPointerUp();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? DIVIDER_LARGE_STEP : DIVIDER_STEP;
    if (event.key === "Home") this.setPaneHeight(this.maxPaneHeight());
    else if (event.key === "End") this.setPaneHeight(MIN_EDITOR_HEIGHT);
    else this.setPaneHeight(this.paneHeight + (event.key === "ArrowUp" ? step : -step));
  }

  destroy() {
    this.onPointerUp();
    this.divider.removeEventListener("pointerdown", this.boundPointerDown);
    this.divider.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("resize", this.boundWindowResize);
    this.view?.destroy();
    this.view = null;
  }
}
