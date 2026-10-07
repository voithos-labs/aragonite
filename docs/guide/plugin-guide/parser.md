# Teaching the parser

Part of the [plugin guide](../plugin-guide.md): the full story of the opener [the quickstart](../plugin-guide.md#the-first-fifteen-minutes) registers for the parrot.

The parrot opener at the top of this guide left two numbers unexplained (`priority: 25` and `consumed: 1`). This section explains both, then takes the three questions a real grammar meets sooner or later:

1. what an opener that reads ahead and then backs out has to tell the editor,
2. how an opener knows where in the document it is,
3. and how a construct whose lines must sit together ever gets typed.

## What an opener returns

`tryOpen` returns `null` to decline, or a `BlockOpenerResult`: the node it built plus `consumed`, the number of lines it claimed starting at `ctx.index`. It's a count, not a position. A single-line block returns `consumed: 1`; an opener that scanned forward to a closing line at `closeIdx` returns `closeIdx + 1 - ctx.index`.

Here's what the parrot's `tryOpen` sees for the third line of `'# Hi\n\n%%parrot party responsibly\n'`, and what it hands back:

```ts
tryOpen(ctx) {
	ctx.index; // 2, the line's position in ctx.lines
	ctx.line; // { raw: '%%parrot party responsibly\n', text: '%%parrot party responsibly', lineEnding: '\n', start: 6, end: 33 } (byte offsets into the source)
	ctx.leadingTrivia; // '\n', the blank line above, which the node keeps
	ctx.depth; // 0 at the document root; a blockquote body would be 1
	ctx.isDocumentParse; // true, this parse was handed a whole document
	return { node: { kind: parrot, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 };
}
```

`consumed` must be at least 1. Claiming nothing is the one return that could spin the parse loop forever, so the parser declines it in every build and warns in dev ([Misuse outcomes](../plugin-guide.md#misuse-outcomes)).

Heads up, the scanners the package exports hand back a position, not a count: `blockquoteExtent` returns a `nextIndex`, so your opener returns `nextIndex - ctx.index`.

## Opener priority

An opener's `priority` decides dispatch order, and **lower runs first**. `OPENER_PRIORITIES` is the built-ins' order:

| Priority | Built-in kind             |
| -------: | ------------------------- |
|       10 | `fencedCode`              |
|       20 | `heading`                 |
|       30 | `thematicBreak`           |
|       40 | `blockquote`              |
|       50 | `list`                    |
|       60 | `indentedCode`            |
|       70 | `htmlBlock`               |
|       80 | `linkReferenceDefinition` |

Two rules place a plugin opener on it:

1. **Price _below_ a built-in whose matcher is a superset of yours.** `fencedCode` accepts every fence, ` ```mermaid ` included, so the Mermaid opener must win first: `OPENER_PRIORITIES.fencedCode - 5`. If a built-in would also match your syntax, you sit ahead of it or it claims the block.
2. **Otherwise slot into a gap between built-ins.** `<details>` is only ever an `htmlBlock`, so it prices into the gap just below: `OPENER_PRIORITIES.htmlBlock - 5`. Express the number as an offset from the built-in you reason about, never a bare literal.

Ties break by kind name, never by registration order. A shared priority is a smell all the same, and the dev build warns on it. Price into a gap instead.

**Claiming ahead of a built-in is also how you replace one.** Price your kind below the built-in whose syntax you want (the Mermaid fence is exactly this), and your kind owns those bytes: its own component, its own descriptor, its own closure row. Remove your plugin and the built-in takes the bytes back unchanged. There's no other way to override a built-in's component or descriptor.

For your pricing map: the opt-in `:::name` directive grammar registers its container opener at 45, between `blockquote` and `list`.

## A reading that isn't final

Some openers read past their first line looking for something and decline when it isn't there. The `$$` math block hunts down the page for its closing `$$` and gives up without one, so its line ends up a plain paragraph, which a `$$` typed further down can still turn into math. If yours works like that, give it `readingNotFinal`. It gets a block's own bytes and answers one question: is my reading of these bytes final, or could more lines below change it?

An opener that reads on and never backs out doesn't need one. A fence left open just runs to the end of the document, like the built-in code block's, and nothing typed below changes that.

```ts
registerBlockOpener(mathBlock, {
	priority: OPENER_PRIORITIES.fencedCode + 5,
	interruptsParagraph: (text) => text === '$$',
	// A lone `$$` with no closing `$$` under it is still waiting
	readingNotFinal: (raw) => {
		const [first, ...rest] = displayLines(raw);
		return first.text === '$$' && !rest.some((line) => line.text === '$$');
	},
	tryOpen(ctx) {
		// scans for the closing `$$`, and returns null when there isn't one
	}
});
```

Here's why the editor cares. After each edit it rejoins neighbouring blocks wherever a reload would read them as one, and to keep that cheap it only looks at the first line of the block below. The line that turns a waiting `$$` into math can be anywhere further down, so leave `readingNotFinal` out on an opener like that and typing the closing `$$` a few lines below leaves two blocks on screen where a reload shows one.

Answer true only while the reading really isn't final:

- A closed `$$` block is done, and so is any block whose first line isn't yours, so check the first line before scanning the rest.
- Keep it a string scan, never a parse.
- Every true makes the editor read both neighbouring blocks in full instead of one line, on every edit next to that block, so a true that should've been false costs you there.

## Openers and document position

`OpenContext.isDocumentParse` tells an opener whether the parse it's dispatching in was handed a whole document or one block's bytes:

- **`true`** for `parse(source)` (the default scope) and for the editor's load of the `source` prop.
- **`false`** for every reparse the editor runs while you type, which pass `{ scope: 'fragment' }`: commits, split and merge, pastes, a container body.

`index === 0` doesn't answer it: that only says the block is first in the parse window, and a window starting mid-document has a first block too. A kind scoped to a document position (front matter, say) gates on the whole composition rather than the flag alone:

```ts
tryOpen(ctx) {
	if (!ctx.isDocumentParse || ctx.index !== 0 || ctx.depth !== 0 || ctx.leadingTrivia !== '')
		return null;
	// ... your syntax
}
```

Three habits complete the gate:

- **The flag stays the same inside nested containers**, so `depth` is what tells you a blockquote or list body isn't the document top. If your opener parses its own body with `parseContainerBody`, pass the scope on yourself: `ctx.isDocumentParse ? 'document' : 'fragment'`, plus `depth: ctx.depth + 1` and `grammar: ctx.grammar`. A body you assembled yourself passes `'fragment'`.
- **Declare `interruptsParagraph: false`**: a line that interrupts a paragraph has a paragraph before it, so it's never at line 0.
- **Pair the opener with a paste transform** ([Paste transforms](paste-transforms.md#paste-transforms)): pasted text reaches `parse` as a fragment, so your opener declines it, and the transform is where you decide what pasted front matter should become (a fenced block, say) instead of leaving the syntax live mid-document.

One limit, stated plainly. A fragment edit that should dissolve the kind does dissolve it: break the closing fence and the block becomes whatever blocks its bytes now warrant. Restoring those bytes doesn't put the kind back in the live tree, because every reparse after a commit is a fragment parse (the one that joins neighbouring blocks included), and your opener declines those. `getSource()` returns the correct bytes and a reload restores the block. Typing the syntax at the document top hits the same wall: the kind only appears after a reload.

## Typing a multi-line construct into existence

An opener recognizes syntax that's already there. A grammar whose lines must be **adjacent** (a table's header over its delimiter, a `$$` fence over its closer) can never get there by typing at all, because Enter splits a paragraph into a blank-line-separated pair, and two adjacent prose lines would just re-parse as one paragraph. `registerBlockCompleter` closes that gap: your completer reads the one line the user typed and answers the canonical lines that complete it.

```ts
registerBlockCompleter(myKind, {
	tryComplete: (line) =>
		trimWhitespace(line) === '$$'
			? { lines: ['$$', '', '$$'], caret: { path: [], line: 1, column: 0 } }
			: null
});
```

Your `tryComplete` only runs on a one-line block of prose with no markers of its own and the caret at its end, so the line you receive is the whole typed line and never a kind's own markers. Return `null` to decline, and the press splits as usual. Completers are asked in kind-name order, never registration order.

With that completer registered, typing `$$` into an empty paragraph and pressing Enter leaves the document holding `$$\n\n$$\n`, with the caret on the empty middle line, ready for the formula. Add `onType: true` beside `tryComplete` and it's also tried as the line is typed, no Enter needed, which suits a line that means one thing the moment it's complete (a lone `$$`). It's off by default, since a table's header row might be a longer row someone's still typing.

Two rules for the answer:

- `lines` come **without** line endings. The editor attaches the block's own (or the document's), so a CRLF document stays CRLF.
- The caret is a `path` (child indices inside the completed block, empty for the block itself) plus a `line` and `column` inside that node, never a byte offset, since only the editor knows which line ending went in.

The completion is one undo entry: undo gives you back the typed line with the caret at its end.

Two bounds worth knowing:

- Your lines are re-parsed by the ordinary parser, so a completer can only create what a reload of those bytes would produce, which means registering the opener that recognizes them first.
- A completer sees a line, never a position, so a grammar that's only legal at one place in the document isn't a completion candidate.
