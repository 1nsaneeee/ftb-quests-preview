# IntelliSense Workbench Design

## Approved direction

The details view becomes a vertically split central workbench: the existing quest preview above, and a CodeMirror 6 description editor below. The divider is keyboard- and pointer-adjustable. Preserve the current charcoal-and-gold visual language, existing quest/map switch, right-side quest properties and preview settings, and the shared save/discard workflow. Move the native page controls and `1/N` indicator into the central preview area so they stay close to the canvas and remain synchronized with clickable page areas in the preview.

## Ownership and data flow

- `app.js` remains the sole owner of quest selection, locale, `state.page`, page count, and drafts keyed by locale and quest ID.
- A new `DescriptionEditor` owns the CodeMirror `EditorView`, local completion/snippet extensions, editing-session transitions, and divider interaction. It receives a stable editor host and snapshots; it reports text changes and explicit save requests through callbacks.
- The editor view must not be recreated for width/scale/page redraws. When the selected quest or locale changes, keep the same `EditorView` but install a new `EditorState` with the same extensions via `view.setState()` so completion/snippet state and undo history are isolated across quest documents. Saving and API conflict/error rerenders keep the same view and state.
- Text input updates the draft only. It must not force the page index to zero; after draft/width changes, clamp the current page against the renderer's current page count. The existing absolute `onPageChange(page)` callback updates `state.page`; `onPageInfo(page,count)` remains the page-count/source-of-truth callback.
- The app's `/` search shortcut must ignore CodeMirror's editable DOM and other editable targets. `Ctrl+S`/`Cmd+S` in the editor invokes the existing save action and prevents browser Save Page; it does not enable autosave.

## Completion behavior

Local completion only; no network requests, live game access, external resource index, AI continuation, `{item}`, or `{link}`.

- `&` or `§` offers the renderer-supported `0`–`f` color codes, `r` reset, and `k/l/m/n/o` styles, with Chinese descriptions and visible color swatches. A leading `#` hex-color entry stays disabled until the renderer's missing-`#` color value bug is fixed and browser-tested.
- `{` offers only whole-line `{@pagebreak}` and renderer-supported `{image:...}`. Page break insertion must create a standalone line without deleting adjacent text. Image insertion uses the renderer's exact order `image`, `width`, `height`, `align`, with the resource ID as an explicit editable placeholder, never a claimed existing asset.
- Typing `gold`, `bold`, `reset`, `page`, or `img` without a sigil offers the same snippets. Do not intercept Tab unless a completion is open or snippet fields are active. Then Tab accepts the selected completion or advances a snippet field; Shift-Tab moves to the previous active field. Enter remains a newline key and Escape closes a popup/clears snippet fields. Outside completion/snippet state, Tab follows browser focus navigation. A visible completion entry point and clear Escape-then-Tab/focus guidance avoid relying on Ctrl+Space, which may belong to a Chinese IME.
- While `EditorView.composing`/composition events are active, do not open completions, hijack Enter/Tab, or replace the document. The completion source is driven by editor text around the cursor and must preserve selection and nonmatching text.

## CodeMirror packaging

Use CodeMirror 6 as development dependencies, not a runtime CDN or downloaded-on-first-use dependency. Build an offline browser module under the package's generated editor-asset directory with an explicit build script and lockfile. The package's `prepack`/publish-build path must generate that asset before packing, and the npm `files` allowlist must include it and relevant license notices. CLI/headless entry points continue importing only current server modules and must not require a browser bundle or DOM. `npm install -g` remains the end-user installation workflow.

Before implementing keybindings, use the installed package's TypeScript declarations and official CodeMirror docs. CodeMirror intentionally leaves Tab to the browser by default; bind Tab conditionally only for active completion/snippet state and preserve the focus escape path. Include package licenses in the distribution.

## Verification gates

1. Behavior tests first: completion context and replacement ranges, formatting options, page-break standalone-line insertion preserving surrounding text and selections, image field order/placeholders, help aliases, UTF-16 offsets for CJK/emoji, and no hex option until color parsing is corrected.
2. Real CodeMirror/DOM tests: completion acceptance and snippet Tab/Shift-Tab/Escape behavior, Enter-as-newline, composition suppression, and undo/redo in one transaction. Do not test with a fake editor or source-string assertions.
3. Build/pack contract: syntax check, targeted tests, build, package dry-run in an isolated output location; verify emitted module and license notice are included, and the headless CLI can run without loading the bundle.
4. Manual browser QA on an isolated temporary fixture/server: desktop and 390px layout, divider pointer/keyboard/min bounds/cancel, preview redraw after divider movement via observing the scroll viewport (not window resize), completion keyboard and visible entry, IME limitation explicitly noted if physical input cannot be tested, context switches with isolated undo histories, save/reload/backup, and conflict retention. Never use or mutate the user's real quest data or the existing 4173 service.

## Non-goals

No source quest or locale data changes, no server/parser rewrite, no external completions, no AI completion, no broad CodeMirror language mode, no changes to the established dark/gold theme direction, and no npm publish/version bump/commit/push.
