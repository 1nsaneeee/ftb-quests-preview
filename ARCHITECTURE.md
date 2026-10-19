# Front-end component boundaries

The browser app is served as native ES modules; there is no bundler or framework runtime.

- `app.js` is the composition root and the single owner of shared selection, locale, page, width, scale, and in-memory draft state. It fetches `/api/data`, watches `/api/events`, wires cross-component callbacks, and fans snapshots out to mounted components.
- `components/quest-navigation.js` owns the searchable chapter/quest list and emits quest selection.
- `components/quest-details.js` owns the detail canvas and its resize/draw lifecycle. It delegates Minecraft text shaping to `lib/minecraft-text.js` and uses the shared read-only asset loader passed at construction.
- `components/preview-controls.js` owns locale, width, GUI-scale, paging, and the shared description draft control. It reports intent through callbacks; it does not fetch or mutate source files.
- `components/quest-editor.js` owns the edit inspector fields and save/discard controls. It emits field changes and actions; `app.js` applies drafts and coordinates API calls.
- `components/quest-map.js` owns chapter selection, graph canvas, node hit-testing, pan/zoom, labels, dependency highlighting, keyboard navigation, and edit-mode node dragging. It receives the API data snapshot and emits selection/position callbacks. Cross-chapter dependencies are listed as navigation buttons; remote nodes are not projected into local coordinates.
- `lib/minecraft-text.js` contains the text-format, line-wrap, page-break, and local glyph/advance logic used by the detail renderer. The graph intentionally uses browser UI text, not the in-game font renderer.
- `styles/navigation.css`, `styles/quest-details.css`, `styles/preview-controls.css`, and `styles/quest-map.css` style their respective component surfaces; `styles.css` is limited to application-wide tokens and shell layout.

Components follow `mount()`, `update(snapshot)`, and `destroy()` where they own DOM listeners or drawing resources. `app.js` keeps the only shared mutable state and removes global listeners, the event stream, and glyph callbacks on unload. Source quest, locale, and asset data is read through the server API. The edit inspector is shown whenever the API reports `editing.enabled` and a quest is selected; node dragging additionally requires the map's edit-layout toggle. Browser drafts are keyed by locale and quest; when saving is enabled, `POST /api/save` sends only changed fields with the current revision map and token. The server owns backup creation and rejects stale revisions, while the browser retains drafts on conflicts or other failures.

## Server and install boundaries

- `cli.mjs` is the headless AI/script entry point (published as the `ftbquest` bin). It resolves the same source as `server.mjs`, then uses `server/store.mjs` for reads/lint and `server/save-service.mjs` for dry-run/apply. Patch is dry-run by default; `--apply` is required to write.
- `server.mjs` is also the `ftbquest-preview` bin for the browser UI.
- `skills/ftbquests/SKILL.md` is the agent-facing instruction set (when to use the CLI, read/edit workflow, patch contract, safety). `AGENTS.md` points agents at that skill and the `ftbquest` command.
- `server/store.mjs` owns the headless read model: localized chapter/quest records, chapter groups, revisions, raw SNBT, search, and lint entry points. It is independent of the browser UI.
- `server/lint.mjs` contains offline consistency rules (IDs, dependencies/cycles, coordinates, shapes, task/reward types, locale titles, chapter metadata). It is intentionally read-only.
- `server/schema.mjs` records the 2101.1.26 field/enum model exposed by `schema`, including which fields the current patch API can write.
- `server/diff.mjs` builds context line hunks for patch dry-runs.
- `server/source.mjs` owns the editable demo-copy preparation shared by the browser server and CLI.
- `server.mjs` binds `127.0.0.1` only and serves the static modules plus `/api/data`, `/api/font`, `/api/asset`, `/api/events`, and `/api/save`. Write requests require the loopback `Host`, same-origin `Origin`, JSON content type, and the per-process write token.
- `server/config.mjs` resolves CLI/environment paths from the process working directory and local-config paths from the config file's directory. Setup stores relative paths when possible; an explicit but invalid source is an error rather than a silent demo fallback.
- `server/save-service.mjs` validates the request, verifies every revision before mutation, writes a recoverable backup manifest, stages replacements, rechecks the targets, and restores already-replaced files if a later commit fails. `dryRun` reuses the same validation and diff path without writing.
- `server/snbt-edit.mjs` applies source-span edits so comments, unknown keys, BOM, line endings, and ordering outside the edited fields survive. Locale writes use the FTB Quests keys `quest.<id>.title`, `quest.<id>.quest_subtitle`, and `quest.<id>.quest_desc`.
- `install.mjs` is the cross-platform data-source setup implementation. `install.cmd` is the Windows double-click wrapper (Node guard plus `install.mjs`) for source checkouts. `install.ps1` installs the package globally from a generated tarball, registers the npm bin directory in the user PATH, and copies the agent skill. `start.cmd` starts the browser server after checking Node. `scripts/check-syntax.mjs` walks all Node modules in the project except ignored local directories.
- `package.json` exposes `ftbquest` (CLI) and `ftbquest-preview` (browser) bins, a `files` whitelist that keeps tests/docs/install wrappers out of the tarball, and `exports` for the headless store/lint/schema/save-service modules.

The graph is a static layout preview: it reads real chapter/quest coordinates, shape/size metadata, icons, and dependencies. It does not emulate unlock state, completion state, the full quest book tree, every FTB rendering detail, or 3D item rendering.
