import { EditorSelection } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { snippet } from "@codemirror/autocomplete";

export function formatSelection(code) {
  return view => {
    if (view.state.readOnly || view.composing) return false;
    const changes = view.state.changeByRange(range => ({
      changes: [
        { from: range.from, insert: `&${code}` },
        { from: range.to, insert: "&r" },
      ],
      range: EditorSelection.range(range.from + 2, range.to + 2),
    }));
    view.dispatch({ ...changes, scrollIntoView: true, userEvent: "input.format", annotations: isolateHistory.of("full") });
    return true;
  };
}

export function insertLink(view, range = view.state.selection.main) {
  if (view.state.readOnly || view.composing) return false;
  const { from, to } = range;
  const selected = range.text ?? view.state.sliceDoc(from, to);
  // Escape selected text for JSON, then for CodeMirror's snippet syntax.
  const text = JSON.stringify(selected || "打开网页").slice(1, -1).replace(/[{}]/g, "\\$&");
  const prefix = from > view.state.doc.lineAt(from).from ? "\n" : "";
  const suffix = to < view.state.doc.lineAt(to).to ? "\n" : "";
  const template = `${prefix}\\{"text":"${text}","color":"aqua","underlined":true,"clickEvent":\\{"action":"open_url","value":"\${1:https://example.com}"\\}\\}${suffix}`;
  snippet(template)(view, null, from, to);
  return true;
}
