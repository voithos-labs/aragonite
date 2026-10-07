# Block commands

Part of the [plugin guide](../plugin-guide.md). The worked command, `conspiracy.setVerdict`, comes from [the container walkthrough](container-walkthrough.md#the-registration-module).

**`registerBlockCommand(kind, name, handler, options?)`**

Creates a `(kind, name)` command and returns its id, which a keymap binding then targets; the walkthrough's `conspiracy.setVerdict` is the worked example. The optional `options` say what the command does over a selection (**Over a selection**, below). The name is dot-separated words that each start with a lowercase letter (`conspiracy.setVerdict`), and it can't be a built-in command's id. Your plugin may reuse one name across several of its own kinds (one `conspiracy.setVerdict` on every kind it ships), as long as the registrations run inside its `setup`. A name already taken by a **different** plugin is rejected, and so is a reuse from outside any plugin's setup.

```ts
const setVerdict = registerBlockCommand(conspiracy, 'conspiracy.setVerdict', (ctx) => {
	if (typeof ctx.arg !== 'string') return false; // the binding's arg arrives as unknown
	ctx.updateMetadata({ name: ctx.arg }); // one undoable commit, through the kind's rebuildRaw
	return true;
});
setVerdict; // 'conspiracy.setVerdict', branded as a command id
// where it goes, in the descriptor: keymap: [{ chord: 'Mod+8', command: setVerdict, arg: 'debunked' }]
registerBlockCommand(conspiracy, 'conspiracy.setVerdict', handler); // throws: already registered
```

A block command's chord fires in two places, the ones that hand it a `BlockCommandContext` (the focused node plus a way to commit its metadata):

- a `createEditableLeaf` block, from the focused leaf's keymap;
- a container-factory block, as a chord bubbles up from a leaf inside it.

So bind commands to your own plugin kinds. A command bound on a built-in kind (paragraph, code, table cell) does **not** dispatch, and the chord is swallowed.

A host's `editor.runCommand(id)` doesn't reach a **block** command either: it finds no handler and a dev build warns. Bind a chord, or expose an API of your own, for a block affordance a host must invoke without a keystroke. A **global** command (below) is different: `editor.runCommand('wordCount.log')` runs it and `canRunCommand` answers `true` for it.

**View state rides `ctx.hooks`.** A view-state command (open an editor, open a focus overlay) has to reach the mounted component, so hand `createContainerBlock` a `commandHooks: () => ({ openEdit, openFocusView })` getter and the handler gets it back as `ctx.hooks`. It's read at dispatch, so an undo that replaces the node still hits the current handlers. `hooks` is typed `unknown`: cast it to your own type in the handler, and decline when it's `undefined`, which means no instance of the kind is mounted.

A handler that throws doesn't take the editor down: the gesture does nothing and an `error` event of origin `command` fires, naming the kind, the command id, and the plugin that registered the command. That's also the plugin whose `EditorContext` the handler gets as `ctx.editor`, even when the kind belongs to someone else.

**Over a selection.** The examples here use a made-up `poem` kind whose verses start with `~ `, and a `splitVerse` handler, bound to Enter, that breaks a verse in two at the caret.

Over a selection spanning blocks, a key bound to your command does nothing by default: your handler isn't called and the selection stays. Pass `{ overRange: 'afterRemoval' }` as a fourth argument and the key removes the selection first, the way Backspace would, then runs your command at the caret that's left, as the built-in Enter and Mod+1 do. The binding the editor reads is the one in the block the removal leaves the caret in, so your command runs when that block is one of yours.

Over a selection inside your block, your command runs at the caret with the selection still there, which is right for most commands (a toggle reads the selection, it doesn't want it gone). A command that breaks the line wants what Enter does: pass `overSelection: 'afterRemoval'` too, and the selected text goes first, then your handler runs at the caret it left, with `ctx.node` already holding the shorter text. The removal and whatever your handler writes before it returns undo as one step (a write after an `await` lands in a step of its own).

```ts
const newVerse = registerBlockCommand(poem, 'poem.newVerse', splitVerse, {
	overRange: 'afterRemoval',
	overSelection: 'afterRemoval'
});
// in the descriptor: keymap: [{ chord: 'Enter', command: newVerse }]
// select from '~ ro|ses' into 'vio|lets', press Enter: '~ rolets' is left, then splitVerse runs between 'ro' and 'lets'
// in '~ roses', select 'se' and press Enter: '~ ros' is left, then splitVerse runs between 'ro' and 's'
```

Two things are different once a removal came first. `ctx.afterRemoval` is `true`, so if your command has an "Enter on an empty line" branch of its own (leaving the block, say), skip it then: the line is empty because the selection went, not because the user left it empty. That's how the built-in Enter keeps a whole-item selection inside its list. And the key is taken once the removal runs, whatever your handler returns: `false` can't hand it on to the browser or another binding, since the selection is already gone.

**`registerRangeIndent(kind, command, shift)`**

Tab over a selection that spans blocks indents what it covers: list items nest, code lines shift. Your kind joins in when its keymap binds an indent key to your own command and you tell the editor what that command does over a range. `shift` gets one of your blocks and the stretch of its text the selection covers, and hands back the new text plus where the selection now sits in it, or `null` when nothing changes. The text is the block's raw without its final line ending. Skip the registration and your blocks just sit there under a range (Tab is still taken, so focus doesn't wander off the editor).

```ts
const indent = registerBlockCommand(poem, 'poem.indent', indentAtCaret);
// in the descriptor: keymap: [{ chord: 'Tab', command: indent }]
registerRangeIndent(poem, indent, (node, range) => ({
	text: '~ \t' + node.raw.replace(/\r?\n$/, '').slice(2),
	selection: { start: range.start + 1, end: range.end + 1 }
}));
// a selection from the paragraph above into '~ roses are red', then Tab: '~ \troses are red'
```

Every block of your kind the selection reaches gets one call, and the whole press is one undo entry, list moves and code shifts included. Only add whitespace. In development the editor checks that an indent over a range adds and drops no text, and it warns if you register a line shift on a container kind, since a range indent only asks the leaf holding the text.

**`registerGlobalCommand(name, handler, { chord }?)`**

The editor-wide sibling: it creates a process-wide command whose handler receives the dispatching instance's `EditorContext` rather than a block, so it runs regardless of which block holds focus, for editor-scope actions like opening a panel. Its second argument is whatever `runCommand(id, arg)` or the chord's binding passed, `undefined` when neither did. The chord is optional; without one the command runs only through `runCommand`. Call it from `setup`:

```ts
setup(ctx) {
	registerGlobalCommand(
		'wordCount.log',
		(editor) => {
			// The handler isn't bound to your options type: it gets EditorContext<unknown>,
			// so cast options here (onEditor's callback is where they read typed).
			const opts = editor.options as WordCountOptions;
			console.log(`[${editor.editorId}]`, countByEditor.get(editor.editorId), opts);
			return true; // handled
		},
		{ chord: 'Mod+Shift+L' }
	);
	ctx.onEditor(/* … */);
}
```

A handler that waits on something before it writes (a fetch, a dialog) should read `editor.documentGeneration` before the wait and compare it after: if the host loaded another note meanwhile, a write through `editor` lands in that one.

The chord binds in the **plugin-global tier**, the last step in the chord priority order [the consumer guide's Rebinding chords](../consumer-guide.md#rebinding-chords) lays out. Three consequences:

- A plugin chord never shadows a built-in: a built-in kind's own chord beats yours **on that kind, not elsewhere**.
- A chord the global tier already binds (undo and redo, or another plugin's global chord) or the search bar reserves (`Mod+F` / `Mod+H`) can't be taken, and the collision **throws before the command is created**.
- A handler throw is contained the same way a block command's is.

```ts
registerGlobalCommand('wordCount.log', handler, { chord: 'Mod+Shift+L' }); // 'wordCount.log', branded as a command id
registerGlobalCommand('mine.find', handler, { chord: 'Mod+F' }); // throws: reserved by the editor UI (search)
registerGlobalCommand('mine.undo', handler, { chord: 'Mod+Z' }); // throws: already bound to "history.undo"
registerGlobalCommand('mine.bold', handler, { chord: 'Mod+B' }); // fine: fires on a thematic break, yields to bold in a paragraph
```

Chord strings follow the consumer guide's chord model: fixed-order `Mod` / `Alt` / `Shift` plus the key's own value. Shifted-symbol chords aren't modeled, so bind plain digits and letters. A chord the editor can't read throws when you register it, here and in a kind's `keymap` alike (`registerBlockKind`, `augmentBlockKind`). So `Ctrl+B` (it's `Mod+B`) fails at startup instead of quietly becoming a bare `B` that fires on every keypress.

## Block context actions

**`registerBlockContextActions(kind, name, provider)`**

The right-click menu on a block of `kind` (a code block, a table, a plugin's own block) lists what its providers return, ahead of the editor's own rows (copy, replace with the clipboard, remove). Register from `setup`. The provider runs on every open, so it reads the block as it is then.

- The rows show only in the editors that list your plugin, and no menu opens in reading mode.
- Several providers can share one kind under different names (a taken name throws), and the kind `'*'` registers for every kind, listed after the editor's own rows.
- Right-clicking the text of a `pageRole: 'prose'` block (a paragraph, a heading) gives the clipboard rows instead, and never asks your provider.
- The provider's third argument, `noun`, is what the menu calls the block ("code block", or "images" for a paragraph of two pictures), handy for a label that matches the editor's own "Copy code block".

```ts
registerBlockContextActions(conspiracy, 'debunk', (node) => [
	{
		id: 'conspiracy.debunk',
		label: 'Mark debunked',
		icon: 'check',
		run: (ctx) => ctx.replaceRaw(node.raw.replace(/^:::conspiracy/, ':::debunked'))
	}
]);
```

`run` receives a `BlockActionContext`:

- the node and its path (the menu opens on top-level blocks, so a one-index path), and the document's `lineEnding`;
- `deleteBlock()`, and `replaceRaw(raw)`, which rewrites the block's bytes wholesale (through your kind's `rawWrite` rule, if it has one) and reparses them, line breaks converted to the document's own. Each is one undo entry;
- `transformPaste(text)`, for an action that writes the clipboard's text into the document, so it gets the rewrites a paste into that editor would.

On the row itself, `icon` names a glyph the editor's menus already draw (the same set the code rail and the table menu use), and `danger` paints the row in the error colour, for an action that isn't one undo away.
