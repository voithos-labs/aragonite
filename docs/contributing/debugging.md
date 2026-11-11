# Debugging

Read this when you have a bug in hand and are about to trace the editor's state in your head. Dump it first, trace second: the tree, the selection, the undo stack and the recent operations all print as text, and the dump is usually faster than you are.

## The debug panel

The demo app has a panel that shows all of it live (`src/routes/debug-panel/`). Run `npm run dev`, open the showcase at `/` or the harness at `/test/editor`, and press Ctrl+Shift+D (Cmd on a Mac). The showcase also has an "under the hood" button for it. An app that embeds the editor doesn't get the panel.

- **CST tree** is the one to watch. It prints the live tree, then a fresh parse of the current source. When the two differ, that difference is usually the bug.

  ```
  --- LIVE ---
  [0] paragraph "Hello"

  --- REPARSE OF getSource() ---
  [0] paragraph "Hello"
  ```

- **Interaction trace** records what the text-editing code did around the caret, as it happens, such as the caret's capture and restore and each keydown's verdict. Expanding its section switches it on, and a page reload switches it off again even when the section comes back open. So expand it (or collapse and re-expand it) before you reproduce the bug.
- **Copy all as text** puts every section in one snapshot. Paste it into the bug report.

## From the console

On `/test/editor` the same dumps hang off `window.__test` (`src/routes/test/editor/test-probes.ts`): `dumpTree()`, `dumpSelection()`, `dumpInlineTree()`, `dumpUndoStack()`, `dumpOperationsLog()` and `dumpInteractionTrace()`. `__test.trace.enable()` switches the trace on without the panel.

## In a test

An e2e spec calls the console helpers through `page.evaluate`. A unit test imports the dump functions from `src/lib/debug/inspect.ts` and feeds them the mounted editor's internals (`mountEditor` is in `src/lib/test/harness/mount-editor.svelte.ts`; call it as `mountEditor<EditorTestSurface>` so `__test` type-checks):

```ts
console.log(dumpTree(editor.instance.__test.getDocument()));
```

A dump is for printing (in an assertion's message or a Playwright annotation), never for asserting, because its format isn't stable. Assert on the source, a block's kind, the selection paths or the tree.

## A bug on a phone

Phones have no console worth the name, so record the input instead. Serve the app to your LAN with `npm run dev -- --host`, open the showcase on the phone and tap "under the hood" for the panel. In its **Input recording** section press Record, reproduce the bug, then Stop and Send. Send posts the recording to the dev server, which writes it under `recordings-inbox/`. Where the dev server's route is absent, Send downloads the file instead.

The **include text** box stores every character typed, so tick it only on a document you can share. Without it the recording is still readable, but it can't be replayed.
