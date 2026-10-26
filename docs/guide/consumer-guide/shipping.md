# Shipping it

Part of the [consumer guide](../consumer-guide.md). What changes once the editor leaves your dev browser: in your production build, inside a desktop shell, and in the hands of a user who just hit a bug.

## A production build

Build for production and the editor's dev checks drop out of your bundle. Those are the invariant checks and the `[aragonite:…]` console warnings a dev build gives you, and under Vite they're about 18 KB gzipped.

It takes a bundler that resolves the `production` export condition:

- **Vite, webpack 5**: nothing to do, a production build resolves it on its own.
- **esbuild, Rollup**: add `production` to the bundler's conditions. esbuild drops most of the checks but keeps a couple, plus a few helpers only they use, so it saves more like 5 KB.

A build that doesn't resolve it still works. It just ships the checks, switched off at runtime.

The swap goes through an `exports` subpath the editor imports by its own package name, `@voithos-labs/aragonite/dev-checks`, so your toolchain has to read `exports` maps (any bundler from the last few years does). That subpath's the editor's, not one to import yourself.

## Embedding in a webview shell

A desktop shell (Tauri/wry, WebView2, Electron) runs the editor on the same engine a browser does, so nothing about the component changes. What changes is the layer above it: the shell decides which keystrokes reach the page, and which URLs resolve to a local file. A browser-driven test run can't observe any of that, so verify each item below in the built application. Layout isn't shell-specific; [Embedding in a host layout](../consumer-guide.md#embedding-in-a-host-layout) covers it. Neither is local-file image rendering, which is a URL-policy question; [Which URLs render](../consumer-guide.md#which-urls-render) covers the `asset:` protocol and its per-platform forms.

### Chords the shell may claim

Which chords reach the page, and whether the shell or the document gets first refusal, is shell-specific. Where the shell resolves its accelerator first, the chord is consumed before any `keydown` reaches the document, so the editor never sees it and no `keybindings` override can reach it. Where the shell dispatches to the page first, the editor sees the chord and a capture-phase `preventDefault()` suppresses the shell's own action. Tauri/wry on WebView2 measures as the second kind, with reload and the devtools chords all arriving at the document and their defaults preventable. Assume neither; measure yours.

- **Verify the chord map in the real shell.** A browser run proves the keymap resolves, not that the chord arrives. Walk the [shortcut table](../consumer-guide.md#keyboard-shortcuts) and your own app's bindings in the built application, on every platform you ship, and derive the editor's half of that walk from [`reservedChords()`](../consumer-guide.md#which-shortcuts-the-editor-consumes) rather than copying the table, so it can't go stale between releases.
- **A webview's zoom hotkeys may well be off already.** A zoom control driving `--editor-font-size` (see [Theming](../consumer-guide.md#theming)) reaches for exactly the chords a webview is most likely to reserve, but Tauri's zoom-hotkey option defaults to off, so there `Mod+=` and `Mod+-` arrive at the page untouched. Measure before designing around a collision, and before assuming there's none.
- **A chord's fate can differ between your debug build and your shipped one.** Tauri enables the web inspector by default in debug builds and gates it behind a feature flag in release builds, so `F12` opens devtools while you develop and finds nothing to open in what you ship. Measure in the build you ship.
- **The shell's switches are coarse.** A shell turns a whole family of built-in accelerators on or off, not one chord at a time, and often has more than one family with its own default. Where the shell dispatches to the page first, a capture-phase `preventDefault()` is your per-chord switch. Check your shell's current documentation for what each of its switches covers.
- **A capture-phase key listener of your own needs an "inside the editor" guard.** A host that handles keys on `window` or `document` before the page sees them has to decline the ones headed for the editor, and the test is containment in the element you mounted `<Editor>` into (its root carries the `.editor` class). Watch out for a guard left over from whatever editor you embedded before: its selector matches nothing now, so it reads as "never inside the editor" and quietly swallows every editing chord.

### Clipboard in a webview

**Plain text is the model.** Every copy and cut writes `text/plain`, every paste reads it, and what crosses is Markdown source. The one extra is a rectangle of table cells: its copy and cut also write `text/html` holding a plain `<table>` of the same cells, which is what spreadsheets paste. A paste never reads HTML.

- **A clipboard event may target `document.body` rather than the editor.** Where the selection's focus end hosts no caret (an image-only paragraph, a thematic break), Chromium dispatches `copy` / `cut` / `paste` at the body instead of the focused block. The editor still handles it, but a host listener that claims clipboard events by "the target is outside the editor" will claim the editor's.
- **Multi-line writes normalize to the OS line ending.** The whole-block copy chord (`Mod+C` / `Mod+X` on a block focused as a whole) writes through `navigator.clipboard.writeText`, and Chromium rewrites a multi-line payload to the platform's line ending, CRLF on Windows. Pasting back into the editor reads either ending and writes the document's own, so documents are unaffected; a host that reads the system clipboard itself normalizes on its own side.
- **Writes go through; reads need the shell's permission.** Keyboard copy and cut write through the clipboard event itself. The whole-block chord above, the code block's copy button and the block menu's Copy use `navigator.clipboard.writeText`, which Tauri allows after a click or key on every platform. The menus' Paste rows (the prose and table menus' Paste, "Paste as plain text", and the block menu's "Replace with clipboard") use `navigator.clipboard.readText`, and that's where shells differ. In Tauri, macOS lets it through (with the same Paste prompt Safari shows for another app's text), Windows asks the user with a browser-style Block/Allow prompt, and Linux refuses it outright. Build the window with `enable_clipboard_access()` on Tauri's window builder (the config file has no switch for it) and the read goes through on Windows and Linux too. A refused read or write does nothing, and a cut whose write was refused leaves the block where it was.

### Verify in the shell

Run these by hand in the built application, once per platform you ship. Yes, by hand:

1. Every chord the editor and your app rely on, including whatever the shell reserves for zoom, devtools, and reload.
2. Select-all across blocks containing an image or a thematic break, copy, then paste into an external application.
3. Every async clipboard route listed under [Clipboard in a webview](#clipboard-in-a-webview).
4. Multi-line text copied from a native application and pasted into a block.
5. An image pasted from the system clipboard, if `onPasteImage` is installed (see [Image paste](../consumer-guide.md#image-paste)).
6. A local-file image, on each platform, since the asset protocol takes a different form on Windows (see [Which URLs render](../consumer-guide.md#which-urls-render)).
7. Selection restore across a document or tab swap, if you persist a caret (see [Restoring a selection](../consumer-guide.md#restoring-a-selection)).

A glitch that only reproduces inside the shell is what the interaction trace is for: arm it, reproduce, and serialize a report that travels back out. That's the next section.

## Diagnostics

`getDiagnostics()` is how a bug report gets out of the field. The editor's hardest bugs live in the inline layer, no point pretending otherwise: every state there is transient (the styled spans rebuild on each keystroke), so caret moves, marker reveals and folds, widget churn, and IME composition are gone by the time anyone reads a report. The **interaction trace** records those transitions as they happen, keeping the most recent ones. It ships switched off (it costs next to nothing while off), so arming it is your call, and it's process-global: two editors on one page interleave their entries in the one buffer.

The workflow when a user hits an inline glitch: reproduce, serialize, attach.

```ts
const diag = editor.getDiagnostics();
diag.enableTrace(); // once, behind a "report a bug" affordance, say
// ...the user reproduces the glitch...
const report = diag.serializeDiagnostics();

diag.isTraceEnabled(); // true
diag.traceSnapshot(); // [{ t: 48211.3, site: 'reveal', kind: 'open', detail: { tier: 'construct', construct: 'strong:4-12' } }, ...]
diag.disableTrace();
```

`report` is a Markdown string you drop straight into a bug ticket: a title line carrying the timestamp, then a fenced section each for the trace tail, the recent operations, and the selection.

````markdown
## Interaction trace

```
[812ms ago] reveal/open tier=construct construct=strong:4-12
[640ms ago] text-render/cursor-capture raw=3
[12ms ago] pending-cursor/consume offset=9 applied=true
```

## Operations log

```
[3310ms ago] op=split path=[2] at=14
[1204ms ago] op=input path=[2]
```

## Selection

```
anchor=[2]@14 focus=[2]@14
```
````

`traceSnapshot()` returns the raw entries if you'd rather format them yourself; `disableTrace()` / `isTraceEnabled()` round out the switch.

**The document is excluded by default.** `serializeDiagnostics()` never includes the source unless you pass `{ includeSource: true }`, because a field report mustn't leak a user's content. Opt in only when the bytes are part of the repro and the user has consented.

### Recording input

The trace says what the editor did. An **input recording** says what the browser handed it: every key, input, composition, paste, drop and pointer event, grouped into steps, with the document's hash and the selection after each one. It's the thing to grab when a bug only happens on one keyboard, one phone, or one IME, since it can be replayed (or at least read) without your user's device.

`recordInput()` starts a recording and hands you a handle; `stop()` ends it and returns plain JSON-ready data.

```ts
const recording = editor.getDiagnostics().recordInput();
// ...the user reproduces the bug...
const file = recording.stop();
JSON.stringify(file); // attach it to the report
```

```json
{
  "format": "aragonite-input-recording/1",
  "editor": { "version": "…", "presentationMode": "source", "caret": "auto" },
  "text": false,
  "env": { "userAgent": "Mozilla/5.0 (Linux; Android 15) ...", "uaData": { "platform": "Android", "mobile": true, "brands": ["Chromium 141"] }, "pointer": "coarse", "viewport": [412, 915], "dpr": 2.625 },
  "initial": { "hash": "1o9ql2f51fh", "selection": null },
  "steps": [
    {
      "family": "text",
      "before": { "version": 3, "hash": "1o9ql2f51fh", "selection": { "anchor": { "path": [0], "offset": 5 }, "focus": { "path": [0], "offset": 5 } } },
      "after": { "version": 4, "hash": "1kci6cremz5", "selection": { "anchor": { "path": [0], "offset": 6 }, "focus": { "path": [0], "offset": 6 } }, "splice": [5, 5, 1] },
      "events": [
        { "type": "keydown", "dt": 1840, "trusted": true, "keyCode": 229, "mods": "", "repeat": false, "isComposing": false, "verdict": false },
        { "type": "beforeinput", "dt": 2, "trusted": true, "inputType": "insertText", "isComposing": false, "data": 1, "targetRanges": [{ "raw": [[0], 5, [0], 5], "dom": [5, 5] }], "dom": { "sel": [5, 5] }, "verdict": false }
      ]
    }
  ],
  "expected": [{ "hash": "1kci6cremz5", "selection": { "anchor": { "path": [0], "offset": 6 }, "focus": { "path": [0], "offset": 6 } } }]
}
```

Each recording is its own: a second `recordInput()` runs next to the first, `stop()` twice returns the same data, and unmounting the editor stops whatever's still running. While nothing records, the recorder holds no listeners at all. While one does, it listens on the editor's root, plus `selectionchange` on `document` (the only place the browser fires it), and never touches an event.

**Text is excluded by default**, and here "text" is wider than the document: typed characters, a key's `code` and `keyCode` (they spell what was typed, even under an IME), event `data`, clipboard contents and the editable's DOM text all count. Without text you still get named keys (`Enter`, `ArrowLeft`), Ctrl and Cmd chords, an IME keydown's `keyCode` 229 (it spells nothing), input types, offsets, and lengths where the text would be. The hashes get a secret salt, so they only compare within that one file. That's enough to read what happened, not enough to replay it. `recordInput({ includeText: true })` keeps everything, initial document included, so ask first, same as `includeSource`.

The format is a diagnostics file, not a stable contract before 1.0. `format` names the version, and a reader refuses one it doesn't know. The fields, for when you're reading one:

| Field                      | What it holds                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor`                   | The library version, presentation mode and `caret` prop at the time                                                                                                                                                                                                                                                                                                                 |
| `text`                     | Whether text was kept (see above)                                                                                                                                                                                                                                                                                                                                                   |
| `env`                      | The user agent, `navigator.userAgentData` where the browser has it (Safari and Firefox don't), whether the main pointer is `fine` or `coarse`, the viewport and the device pixel ratio                                                                                                                                                                                              |
| `initial`                  | The document's hash and selection when recording started, plus its `source` with text                                                                                                                                                                                                                                                                                               |
| `steps[].family`           | What the step was: `key`, `text` (inserted with no real keydown, so a soft keyboard or dictation), `rewrite` (any other keyboard-less input, like an autocorrect), `composition`, `paste`, `drop`, `pointer` or `history` (undo or redo with no keydown)                                                                                                                            |
| `steps[].before`, `.after` | The content version (it goes up on every write), the document's hash and the selection, around the step. One step's `after` is the next one's `before`. `after.splice` is `[from, to, inserted]` against the previous source, with the inserted text's length in place of the text when there's none                                                                                |
| `steps[].events[]`         | Each event: `type`, `dt` (milliseconds since the previous one), `trusted`, the key fields and `mods` (`C`trl, `M`eta, `A`lt, `S`hift), `inputType` and `data`, `targetRanges` (as block path plus offset, and as offsets into the editable's text), `dom.sel` (the browser's selection in that text), `clipboard` per type, and `verdict` (whether a handler prevented its default) |
| `expected[]`               | What each step should leave. It starts as a copy of each `after`, and a bug report can edit it to what should have happened                                                                                                                                                                                                                                                         |

A step starts at a keydown (unless only modifiers came before it, so a chord stays one step), at a composition, paste or drop no keydown started, at an input event with no keydown ahead of it, and at a pointer press.
