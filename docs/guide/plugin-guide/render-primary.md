# Recipe: a render-primary block

Part of the [plugin guide](../plugin-guide.md).

Some blocks aren't text at all: a diagram, a chart, an embed, content that renders as a picture and is edited through its own UI rather than through the editor's caret. The bundled mermaid plugin is the worked example: a fenced block drawn whole (`edit: 'box'`), with a textarea of its own.

````ts
const edit = command<Block<never>, DiagramUi>({
	id: 'edit',
	title: 'Edit diagram',
	run: (_editor, _block, ui) => (ui ? ui.openEdit() : false) // undefined while scrolled away
});

const diagram = fencedBlock({
	name: 'diagram',
	label: 'Diagram',
	fence: { info: 'mermaid' }, // the editor reads, writes and grows the fence
	sample: '```mermaid\ngraph TD\n```',
	insert: { label: 'Diagram', icon: 'workflow', insert: '```mermaid\n\n```\n' },
	height: () => 320,
	chords: { 'Mod+M': focusView },
	commands: [edit], // no key, no row: a host binds or runs it
	edit: 'box',
	draw: svelteBlock(DiagramBlock, { context: new Map([[RENDERS, rendersFor(renderer)]]) })
});
````

- **Claim the fence by its info string.** `fence: { info: 'mermaid' }` takes the fences the code block would, gated on the info string's first word. The editor finds the closer, grows a fence past a body line that would close it, and keeps every write legal, a find and replace or a range delete included. Without your plugin the same bytes are a code block.
- **Draw the picture; the editor draws nothing.** A box gets no caret. Your component shows the picture, reads `ctx.theme` where the engine paints its own colours (a theme switch redraws), and takes its engine from your options through `contributes`, so each editor has its own renderer and cache.
- **Write the body once, as the box closes.** Seed the textarea from `block.body` (it breaks lines with a bare LF), and on close or Ctrl+Enter call `editor.edit().body(block, text).commit()`. The editor puts back the block's line endings and grows the fence. Hand `save` too: the editor calls it before an undo, a redo or a mode switch and as the block scrolls out of the window, so the text isn't lost, and a new document drops it. Hold no draft open while the box sits closed: an open draft costs every write in the document a record.
- **Re-seed when the bytes change under you, and on every opening.** An undo or a host's write changes `block.text` while the box is open, and an undo can open it again on its own (an empty diagram); seed it again, or the next close writes text based on bytes that are gone.
- **Give the box the editor's source look.** Add the class `md-source-surface` to your open source (the textarea), and keep only your own padding and overflow beside it. The latex and toc plugins add it to their open source the same way.
- **Keys.** Start the textarea's key handler with `if (imeOwnsKey(e)) return;` and stop the event there, so Ctrl+Z is the textarea's own once it's typed in. Until then let undo and redo through: an undo can reopen the box with the caret inside, and the redo pressed next is the editor's. At its edges an arrow calls `ctx.leave(edge, x?)`: pass the column an up or down arrow came in with (`focus.enter`'s `x`) to keep it. A host's `setSelection` and an undo hand back an `offset` your `offset()` gave; put the caret there. Escape gives whole-block focus back with `ctx.focusWhole()`.
- **Your commands reach the drawing through `controls`.** List an Edit with no key in `commands`, and give `useDrawn` `controls` with what it opens. No type checks a component's controls against its commands, so `check`'s `drawnCommand` row runs each one with it.
- **Claim a press with `keep(event)`, never `stopPropagation()`.** Your component sits inside the editor, so a press it stops never reaches the editor's drag-select or clicks, and a dev build says which drawing did it. Answer true from `keep` for the presses that are yours (a pan, your toolbar, your textarea) and the editor leaves them alone.
- **Show whole-block focus with `ctx.focused`.** The editor's focus host sits beside your drawing, not inside it, so `:focus-within` on your root misses it.

**What you give up with the textarea.** The code text isn't editor-native: no cross-block selection through it, and the caret, IME and undo inside it are the browser's. The editor's chords resume once focus leaves.

The rest of this page is the `setup` plugin's way, which is going away. Its block is an opaque container with no children: read [the container walkthrough](container-walkthrough.md) first if `rebuildRaw` and `updateOwnMetadata` are new to you.

## Whole-block focus

Because the container has no children, a caret can't land _inside_ it, so the kind opts into being focused as a whole: declare `blockFocus: 'whole-block'` on the kind and hand the factory a `getFocusEl` getter returning the element that **declares** the block's focus surface, meaning the one a pointer lands on. The block then behaves like one big character: arrows stop on it, a caret-adjacent Backspace/Delete focuses it before a second press deletes, Enter inserts a paragraph below, undo/redo run from the block itself, and Alt+arrows reorder it. Keys inside your own editing surface never trigger a block delete. Don't skip the declaration: to the editor, any other container with no children is one an edit broke, so a dev build warns (`invariant:keeps-a-block`) on every commit that touches your block, and a paste or a reparse gives it an empty paragraph to hold.

Three gotchas:

- **DOM focus goes to a hidden editing host** the factory mounts in your box, not to your element, so assert containment, not identity, if you test for focus. (An editable declared surface, like your edit `<textarea>`, keeps focus for itself.)
- **Give your box `position: relative`**, or the host resolves against whatever ancestor happens to be positioned.
- **The host is the block's one tab stop**, so there's no tab-order work on your side. A `tabindex` on your declared element gets demoted to `-1` unless the element is itself an editing surface (a textarea, an input, a contenteditable).

Supply a focus element for **every steady state** (error, loading, and static fallbacks included), so a broken render stays keyboard-reachable. If the getter returns null anyway, the editor degrades to focusing your chrome box and warns in dev.

Not drawing it in Svelte? A block type made with `edit: 'box'` gets all of this from its maker: the editor focuses the box whole in every state it shows, and a surface of your own takes the caret through the drawing's `focus`. [React and Vue](react-and-vue.md#a-block-with-its-own-editing-surface) shows one, drawn by a component.

## What your own editing surface has to do

**First: an arrow that runs off your surface has to leave it.** A textarea swallows every arrow at its own boundaries, so a caret that walks in is stuck there, leaving the mouse as the only way out. Call the factory's `moveFocusOut(event)` when the caret sits at the edge the key points at: first line for ArrowUp, last line for ArrowDown, offset 0 for ArrowLeft, the end for ArrowRight. It returns false for a modified or non-arrow key and moves nothing, so gate your own `preventDefault` on its return value. Logical lines (the newlines around the caret) are enough; you owe an exit, not column-keeping. An exit is a blur, so a surface that commits on `focusout` already commits through it.

**Next: your text is a copy, so keep it fresh.** A box seeded once at open goes stale the moment the document changes underneath it (a host undo, say), and the commit on blur then silently reverts that change. The draft below tells you when that happened: re-seed the box from the node once it goes `stale`.

**And hold it as a draft, so it can't land in the wrong note.** A host loading another note tears your block down, and the textarea's blur arrives after the new document is in, so a plain blur commit writes the old note's text into the new one. A **draft** is the editor's record of an edit you're holding outside the document. Open one when the box seeds:

```ts
const draft = openDraft({
	close: (cause) => {
		if (cause !== 'document-swap') commit(); // a document swap writes nothing
	}
});
draft.stale; // false; true once a write elsewhere touched your block, or a `source` swap dropped it
draft.end(); // your box closed, so the editor stops tracking it
```

`openDraft` comes from the container factory, and the draft it opens watches your block's bytes. Check `stale` before every commit, and `end()` the draft when the box closes or your block unmounts with it still open (otherwise a later mode switch calls `close` on a component that's gone). `stale` is reactive, so an effect reading it hears the write underneath while the box is open. Re-seeding is an `end()` and a fresh `openDraft`. The editor calls `close` only on a draft you haven't ended: a mode switch or an undo may still save it, a document swap never. A `close` ends the draft too, so if your box stays open after one (an undo, say), open a fresh draft for it.

The editable leaf does all of this for you (both modes mirror outside changes into the source, and its reveal holds a draft of its own). A plugin-owned surface has to do it itself.

Want a source view with a native caret instead? That's [the editable-leaf tier](editable-content.md#the-editable-leaf), and rebuilding a render-primary block on the editable leaf (block math's shape: a `fencedBlock` with `edit: 'source'`, or `createEditableLeaf` in a Svelte component) is this recipe's upgrade path.
