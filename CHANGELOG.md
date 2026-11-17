# Changelog

## 0.1.3 — 2026-11-17

### Editing

- Added current-description search and replace, including case, whole-word and regex matching.
- Added formatting and link actions with keyboard shortcuts; link snippets escape selected text and select the URL for immediate editing.
- Added brace/bracket pairing that cooperates with FTB component completion.
- Preserve per-quest selection, scroll position and undo/redo history when switching tasks. Reload/discard clears stale history.
- Block editing commands as well as typing while saving.

### Rendering and setup (issue #1)

- Render supported JSON text components and safe HTTP(S) links instead of literal JSON.
- Render legacy title formatting in navigation, breadcrumbs, details and map labels.
- Derive missing quest titles from their first task, using optional instance language resources when available.
- Report malformed optional language resources without failing the whole quest API.
- Show specific setup errors; accept quoted and home-relative paths and explain WSL path handling.

The preview remains an approximation of Minecraft rendering. The reporter's original `setup_failed` cause was not confirmed because its stack trace was not provided. Sidebar collapse and light theme remain deferred.
