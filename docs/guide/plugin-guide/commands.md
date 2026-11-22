# Block commands

Part of the [plugin guide](../plugin-guide.md). The worked command, `conspiracy.setVerdict`, comes from [the container walkthrough](container-walkthrough.md#the-registration-module).

**A block type's `chords` and `actions`**

A plugin value gives its block type keys and menu rows that act on one block. Each names a `command` whose argument is the block:

```ts
const cycle = command<Block<AlertData>>({
	id: 'cycle',
	title: 'Next kind',
	run: (editor, block) => void editor.edit().data(block, { type: next(block.data.type) }).commit()
});

const alert = container<AlertData>({
	// name, label, lines, sample, insert ...
	chords: { 'Mod+7': cycle },
	actions: [{ label: 'Next kind', icon: 'info', command: cycle }]
});
```

Listing the block type is enough; the editor lists `cycle` with your commands. The key works in the alert and in any block inside it, where a key that block binds itself runs first: bound on the alert, `Mod+B` in its paragraph still bolds. A container type can't take a key the text inside edits with: `Enter`, `Backspace` and `Delete` don't compile there, and a letter, `Mod+V` or an arrow leaves its plugin out, with a message naming the key. `editor.run(cycle)` with no block runs on the nearest alert around the caret, and comes back `false` with none; over a selection across blocks, it and the key run once on each alert the selection covers, as one undo step, and the selection stays. A host moves the key with `keybindings: [{ kind: alert, chord: 'Mod+Shift+7', command: cycle }]`. `Tab` stays the page's. Where another plugin's command holds your key as its chord, the plugin listed later is left out.

The rows show in the right-click menu. A block picked up whole lists them above Copy. Right-click in text inside the alert and they come as one flyout named for the type, with its `icon` where it has one, above Cut. A row is greyed where the command's `when` says no.

A row's `label` can be a function of the block, asked each time the menu opens, so the row says what a click will do: ``label: (block) => `Make it ${next(block.data.type)}` ``. A label function that throws, or answers anything but text, shows the command's `title` instead and reaches `onError` under your plugin's name.

A command takes no argument but its block. For "set the kind to one of eight", make one command per kind:

```ts
const setKind = Object.fromEntries(
	KINDS.map((kind) => [
		kind,
		command<Block<AlertData>>({
			id: `set-${kind.toLowerCase()}`,
			title: `Make it a ${kind.toLowerCase()}`,
			run: (editor, block) => void editor.edit().data(block, { type: kind }).commit()
		})
	])
);
// actions: KINDS.map((kind) => ({ label: kind, command: setKind[kind] }))
```

**`registerBlockCommand(kind, name, handler, options?)`**

A `setup` plugin's way, for a kind it registers: it creates a `(kind, name)` command and returns its id, which a keymap binding then targets; the walkthrough's `conspiracy.setVerdict` is the worked example. The optional `options` say what the command does over a selection (**Over a selection**, below). The name is dot-separated words that each start with a lowercase letter (`conspiracy.setVerdict`), and it can't be a built-in command's id. Your plugin may reuse one name across several of its own kinds (one `conspiracy.setVerdict` on every kind it ships), as long as the registrations run inside its `setup`. A name already taken by a **different** plugin is rejected, and so is a reuse from outside any plugin's setup.

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

Metadata survives a reload only when it's in the bytes. `updateMetadata` is the container's write: it merges the patch and your kind's `rebuildRaw` writes it into the bytes. A leaf has no `rebuildRaw`, since its metadata is whatever its opener reads out of its bytes, so a leaf's command rewrites the bytes with `ctx.replaceRaw(raw)` and lets the parse work the metadata out. Here's a memo leaf that tags itself, with an opener that sets `{ tagged: true }` on a line starting `%%!`:

```ts
const tag = registerBlockCommand(memo, 'memo.tag', (ctx) => {
	if (ctx.node.raw.startsWith('%%!')) return false; // already tagged
	ctx.replaceRaw('%%!' + ctx.node.raw.slice(2)); // its own undo entry, even right after typing
	return true;
});
```

Call `updateMetadata` on a leaf and it writes nothing: a dev build warns, and every build reports an `error` event (`origin: 'commit'`) naming `replaceRaw`. One more thing, for a block that shows its source while focused (your leaf, or a block inside your container): press a command's key mid-edit and the command runs once that edit is written, so `ctx.node` holds what the user typed. The key counts as handled then, even if your handler returns `false`.

A block command's chord fires in two places, the ones that hand it a `BlockCommandContext` (the focused node plus the writes that change it):

- a `createEditableLeaf` block, from the focused leaf's keymap;
- a container-factory block, as a chord bubbles up from a leaf inside it.

So bind commands to your own plugin kinds. A command bound on a built-in kind (paragraph, code, table cell) does **not** dispatch, and the chord is swallowed.

A host's `editor.runCommand(id)` doesn't reach a **block** command either: it finds no handler and a dev build warns. Bind a chord, or expose an API of your own, for a block affordance a host must invoke without a keystroke. A **global** command (below) is different: `editor.runCommand('wordCount.log')` runs it and `canRunCommand` answers `true` for it.

**View state rides `ctx.hooks`.** A view-state command (open an editor, open a focus overlay) has to reach the mounted component, so hand `createContainerBlock` a `commandHooks: () => ({ openEdit, openFocusView })` getter (a DOM view calls `ctx.container.setCommandHooks({ openEdit, openFocusView })`) and the handler gets it back as `ctx.hooks`. It's read at dispatch, so an undo that replaces the node still hits the current handlers. `hooks` is typed `unknown`: cast it to your own type in the handler, and decline when it's `undefined`, which means no instance of the kind is mounted.

A handler that throws doesn't take the editor down: the gesture does nothing and an `error` event of origin `command` fires, naming the kind, the command id, and the plugin that registered the command. That's also the plugin whose `EditorContext` the handler gets as `ctx.editor`, even when the kind belongs to someone else.

**Over a selection.** The examples here use a made-up `poem` kind whose verses start with `~ `, and a `splitVerse` handler, bound to Enter, that breaks a verse in two at the caret.

Over a selection spanning blocks, a key bound to your command does nothing by default: your handler isn't called and the selection stays. Pass `{ overRange: 'afterRemoval' }` as a fourth argument and the key removes the selection first, the way Backspace would, then runs your command at the caret that's left, as the built-in Enter and Mod+1 do. The binding the editor reads is the one in the block the removal leaves the caret in, so your command runs when that block is one of yours.

A chord some keymap binds to a line break (Enter, say) is read somewhere else: at the place text typed over the selection would land. Your command runs if that place is in your block, and doesn't if the block there binds the chord to nothing. Over whole blocks after your block, that place is a new paragraph, so Enter opens a line there instead of running your command.

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

**`command({ id, title, chord?, when?, run })`**

The editor-wide sibling, for a plugin value: list it in `contributes` as `commands`, and it runs regardless of which block holds focus, for editor-scope actions like opening a panel. `run` gets your plugin's `Editor` and whatever argument `editor.run(command, arg)` passed (`undefined` from a chord). The editor puts your plugin's name in front of the id, so it runs by value, as `word-count/log`, or by its chord:

```ts
export const wordCount = definePlugin<WordCountOptions>({
	name: 'word-count',
	version: '1.0.0',
	editor: '*',
	defaults: { live: true },
	contributes: (options) => ({
		commands: [
			command({
				id: 'log',
				title: 'Log the word count',
				chord: 'Mod+Shift+L',
				run: () => console.log(count, options) // your options, typed, from the closure
			})
		]
	})
});
```

A `run` that waits on something before it writes (a fetch, a dialog) writes through `editor.edit()`, which comes back refused as `unloaded` if the host loaded another note meanwhile.

The chord binds in the **plugin-global tier**, the last step in the chord priority order [the consumer guide's Rebinding chords](../consumer-guide.md#rebinding-chords) lays out. Four consequences:

- A plugin chord never shadows a built-in: a built-in kind's own chord beats yours **on that kind, not elsewhere**.
- A chord the editor takes everywhere (undo, redo, and the search bar's `Mod+F` / `Mod+H`), or one an earlier plugin in the same list holds, leaves your plugin out of that editor, and the editor tells `onError` why. Only a command that can run without its argument takes a chord, since a key hands it nothing.
- A caret key of the platform the editor runs on (an arrow left or right, a word key, `Home`, `End`, the full list's in [the consumer guide](../consumer-guide.md#keyboard-shortcuts)) yields to the caret: a chord on one warns under `keybindings` in a dev build and never fires there, though a host's own `keybindings` entry can still bind it.
- A throw, or a rejected promise, reaches `onError` under your plugin's name, and counts as run, so the key goes no further.

Chord strings follow the consumer guide's chord model: fixed-order `Mod` / `Alt` / `Shift` plus the key's own value. Shifted-symbol chords aren't modeled, so bind plain digits and letters. A chord the editor can't read is refused up front: in a command it leaves the plugin out with one report, and in a kind's `keymap` (`registerBlockKind`, `augmentBlockKind`) it throws. So `Ctrl+B` (it's `Mod+B`) fails at startup instead of quietly becoming a bare `B` that fires on every keypress.
