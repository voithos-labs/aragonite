# Recipe: a render-primary block

Part of the [plugin guide](../plugin-guide.md). The block here is an opaque container with no children, so read [the container walkthrough](container-walkthrough.md) first if `rebuildRaw` and `updateOwnMetadata` are new to you.

Some blocks aren't text at all: a diagram, a chart, an embed, content that renders as a picture and is edited through its own UI rather than through the editor's caret. The Mermaid reference plugin is the worked example, and the shape generalizes:

```
fence claim ──▶ opaque container, NO children ──▶ component renders the diagram
                  code lives in metadata            edit UI is plugin-owned
                  rebuildRaw re-emits the fence     commits ride updateOwnMetadata
```

- **Claim your grammar, decline everything else.** The opener accepts exactly the fences the built-in `fencedCode` would, gated on the info string's first word, and must price **ahead** of `fencedCode` ([Opener priority](parser.md#opener-priority)). Declining returns the fence to `fencedCode`, which is also your uninstall story: without the plugin the same bytes parse as a plain code block. Pin both states with round-trip tests. Claim the fence with `matchFenceInfo('mermaid')` and read its extent with `scanFence`, which closes where the parser does, rather than writing your own fence rules.
- **Declare the fence's write rule.** Every write to your block's bytes runs through its kind's `rawWrite`, and some never pass your component at all (a find/replace, a range delete). A fence is one byte away from swallowing the document: a body line that reads as the closer ends the block early, and a deleted opener leaves a closer that opens a fence over everything below. `rawWrite: fenceRawWrite(fenceShapeOfRaw)` is the code block's own rule, and it handles both.
- **Code in metadata, an empty container around it.** Register the kind with `container: { contract: 'opaque', rebuildRaw }` and give nodes `children: []`. The source text and every fence byte the rebuild needs (indent, marker, info string, closer shape) go into typed plugin metadata, primitive values only, and `rebuildRaw` re-emits the exact bytes from them. Build the parsed node's `raw` by calling your own rebuild, so opener and rebuild can't disagree. If the rebuild lengthens the fence past a body line (`escalatedFenceLength`), leave the stored length alone: the editor re-reads your metadata from the new bytes through your opener.
- **Edit mode commits through `updateOwnMetadata`.** The component swaps its body to a plugin-owned `<textarea>` seeded from metadata; commit (Ctrl+Enter, blur) writes the new code with the container factory's `updateOwnMetadata`, one undo entry, and your `rebuildRaw` re-emits the fence. Ctrl+Enter also passes `{ caret: { path: [], offset: 0 } }`, so the diagram gets focus back once the new code renders; a blur passes none, since you clicked somewhere else on purpose. Escape cancels without touching the tree. The textarea's text is a copy of the document's, and a copy can go stale, so hold it as a draft ([What your own editing surface has to do](#what-your-own-editing-surface-has-to-do)).
- **Inject the renderer into a slot, and own its CSS.** The engine (the library that actually draws, KaTeX or mermaid) is the consumer's dependency, so take it as a plugin option (`mermaidPlugin({ renderer })`) and put it in a **renderer slot**: a module-level `createAsyncRendererSlot` (or `createRendererSlot`, for an engine that answers right away) that your setup fills and your component renders through. The slot caches each render, and it never throws at you: with no renderer set you get your `missing` output, and a throw or a rejection gets your `failed` output. For anything drawn from source text, `renderSourceFallback(source, message)` makes a decent `missing` or `failed`. Import the engine's stylesheet in the renderer module too, where no route can forget it: a KaTeX-based renderer needs `katex/dist/katex.min.css`, or every equation paints twice.
- **If the engine paints its own colors, the theme is a render input.** A diagram SVG with color literals in it can't be rethemed by a stylesheet, so it has to be redrawn. The slot does most of that for you: `render` takes the theme, hands it to your renderer, and caches per theme. The part left is yours: read `getTheme()` inside the effect that renders, so a switch re-runs it. An engine styled by CSS variables can ignore the theme it's handed.
- **Interior interactivity stays inside your DOM.** Pan/zoom, buttons, overlays: put `POINTER_GESTURE_ATTR` on the element whose drags are yours (only while the gesture is armed, if it isn't always), or the editor reads the press as the start of a selection and paints a range over your pan. `stopPropagation()` on pointerdown can't do this, since the editor's listener has already run by then. A focus view is just a fixed-position overlay in the component's own tree, so mount it in place, focus it on open, close on Escape.
- **View-state commands reach the component through `ctx.hooks`.** See [Block commands](commands.md#block-commands).

The helpers from that list, with what they hand back:

````ts
const matchMermaid = matchFenceInfo('mermaid');
matchMermaid('```mermaid'); // { marker: '`', length: 3, info: 'mermaid', indent: '', infoRaw: 'mermaid' }
matchMermaid('  ~~~ mermaid title'); // { marker: '~', length: 3, info: 'mermaid title', indent: '  ', ... }
matchMermaid('```js'); // null: the code block keeps it
scanFence(ctx, fence); // { closer: 3, consumed: 4, raw: '```mermaid\n...```\n', body: '...' }
fenceRawWrite(fenceShapeOfRaw).normalize('graph TD\n```\n', ctx); // 'graph TD\n': the stranded closer goes

const diagrams = createAsyncRendererSlot<string, { svg?: string; error?: string }>({
	key: (code) => code,
	missing: () => ({ error: 'no renderer' }),
	failed: (_code, error) => ({ error: String(error) })
});
diagrams.set((code, { theme }) => engine.render(code, theme).then((svg) => ({ svg }))); // in setup; null removes it
await diagrams.render('graph TD', { theme: 'dark' }); // { svg: '<svg …>' }
await diagrams.render('graph TD', { theme: 'dark' }); // the same result, and the engine isn't called again
await diagrams.render('graph TD', { theme: 'light' }); // a miss: drawn again for the light theme
````

**What you give up with the textarea.** The code text isn't editor-native: no cross-block selection through it, and the caret, IME and undo inside it are the browser's. The editor's chords resume once focus leaves.

## Whole-block focus

Because the container has no children, a caret can't land _inside_ it, so the kind opts into being focused as a whole: declare `blockFocus: 'whole-block'` on the kind and hand the factory a `getFocusEl` getter returning the element that **declares** the block's focus surface, meaning the one a pointer lands on. The block then behaves like one big character: arrows stop on it (the bundled mermaid diagram is the shipped reference), a caret-adjacent Backspace/Delete focuses it before a second press deletes, Enter inserts a paragraph below, undo/redo run from the block itself, and Alt+arrows reorder it. Keys inside your own editing surface never trigger a block delete. Don't skip the declaration: to the editor, any other container with no children is one an edit broke, so a dev build warns (`invariant:keeps-a-block`) on every commit that touches your block, and a paste or a reparse gives it an empty paragraph to hold.

Three gotchas:

- **DOM focus goes to a hidden editing host** the factory mounts in your box, not to your element, so assert containment, not identity, if you test for focus. (An editable declared surface, like your edit `<textarea>`, keeps focus for itself.)
- **Give your box `position: relative`**, or the host resolves against whatever ancestor happens to be positioned.
- **The host is the block's one tab stop**, so there's no tab-order work on your side. A `tabindex` on your declared element gets demoted to `-1` unless the element is itself an editing surface (a textarea, an input, a contenteditable).

Supply a focus element for **every steady state** (error, loading, and static fallbacks included), so a broken render stays keyboard-reachable. If the getter returns null anyway, the editor degrades to focusing your chrome box and warns in dev.

## What your own editing surface has to do

**First: an arrow that runs off your surface has to leave it.** A textarea swallows every arrow at its own boundaries, so a caret that walks in is stuck there, leaving the mouse as the only way out. Call the factory's `moveFocusOut(event)` when the caret sits at the edge the key points at: first line for ArrowUp, last line for ArrowDown, offset 0 for ArrowLeft, the end for ArrowRight. It returns false for a modified or non-arrow key and moves nothing, so gate your own `preventDefault` on its return value. Logical lines (the newlines around the caret) are enough; you owe an exit, not column-keeping. An exit is a blur, so a surface that commits on `focusout` already commits through it.

**Next: your text is a copy, so keep it fresh.** A box seeded once at open goes stale the moment the document changes underneath it (a host undo, say), and the commit on blur then silently reverts that change. Derive the code from the node, watch that derivation while your surface is open, and re-seed the box when it changes to something you didn't just commit.

**And hold it as a draft, so it can't land in the wrong note.** A host loading another note tears your block down, and the textarea's blur arrives after the new document is in, so a plain blur commit writes the old note's text into the new one. A **draft** is the editor's record of an edit you're holding outside the document. Open one when the box seeds:

```ts
const draft = openDraft({
	seed: code, // the code you filled the box with
	current: () => codeOf(node), // that code now
	close: (cause) => {
		if (cause === 'mode-change') commit(); // 'document-swap' writes nothing
	}
});
draft.canWrite(); // true; false once a `source` swap or a write to those bytes dropped it
draft.end(); // your box closed, so the editor stops tracking it
```

`openDraft` is on `EditorContext`, and the container factory passes it through. Ask `canWrite()` before every commit and `end()` the draft when the box closes. Re-seeding is an `end()` and a fresh `openDraft`. The editor calls `close` only on a draft you haven't ended: a mode switch may still save it, a document swap never.

The editable leaf does all of this for you (both modes mirror outside changes into the source, and its reveal holds a draft of its own). A plugin-owned surface has to do it itself, and the bundled mermaid block is the worked example.

Want a source view with a native caret instead? That's [the editable-leaf tier](editable-content.md#the-editable-leaf), and rebuilding a render-primary block on `createEditableLeaf` (block math's shape) is this recipe's upgrade path.
