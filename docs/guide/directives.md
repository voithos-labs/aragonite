# Directives

Markdown has no syntax for "a box with a name on it" (e.g. no callout, no admonition, no embed, nothing). The community settled on `:::name` fences instead, and aragonite speaks that dialect: a fence with a **name**, and the editor hands the whole thing to whichever plugin claimed the name.

```
:::note Heads up
Some body markdown.
:::
```

Claim the `note` name and you get a real block kind for it: your own component, keymap, commands, the works. A name nobody claimed still parses, renders as a plain labelled box, and saves back byte for byte (i.e. a document written with your plugin survives being opened without it).

---

<details>
<summary>So, what are directives?</summary>
<p>A named box in Markdown, written as a <code>:::name</code> fence, that a plugin can claim by name and turn into its own block</p>
</details>

---

This page assumes you have read the [plugin guide](plugin-guide.md). Directives replace the parsing half of a plugin (you don't write an opener; defined in the next section), not the registration underneath it (you still have to declare a kind).

## One opener for everyone

There is exactly one opener (opener /ˈōp(ə)nər/: the part of the aragonite parser that recognizes the syntax a block starts with. Each block kind usually brings its own; a paragraph is what you get when none of them match.) for `:::`, `::` and `:`, and it dispatches on the name. Your plugin never registers an opener of its own.

The reason is the way this feature usually gets built wrong: if every plugin registered its own `:::` opener, the first one to register would greedily claim every `:::whatever` fence, and no second plugin could ever own its own name. One shared opener, a registry lookup by name, done.

```
:::name info…
      │  the one opener
      ▼
  registry lookup by (tier, name)
      ├─ registered   → your kind
      └─ unregistered → the generic box
```

## The three tiers

| Tier          | Syntax                 | Colons    | Where  | Body                                    |
| ------------- | ---------------------- | --------- | ------ | --------------------------------------- |
| **Container** | `:::name info` … `:::` | 3 or more | block  | nested markdown, real child blocks      |
| **Leaf**      | `::name info`          | 2         | block  | one line, no children                   |
| **Text**      | `:name[label]{attrs}`  | 1         | inline | an atomic widget, source shown on focus |

The colon count is the tier (one colon is text, two is a leaf, three or more is a container). A name is a letter followed by letters, digits or hyphens (no underscores). And the text tier is deliberately shy: `:name` only counts when a `[` or `{` follows immediately, so `:smile:`, `10:30` and `http://` all stay plain text, as they should.

**Nesting containers.** The closing syntax for a container follows a simple rule: it closes on the first line that (only) contains a sequence of colons with length >= the length of the opening colons. This is, coincidentally, the same rule used for the code fences (in that case it's backticks instead of colons).

As a consequence, to nest containers, the outer fence has to be longer:

```
::::note          outer opens with 4 colons
:::warning         inner :::… is body, not a closer
inner body
:::                inner closes (3 ≥ 3)
::::              outer closes (4 ≥ 4)
```

---

<details>
<summary>Pasting BS into the Container</summary>
Don't worry, we've got A-Hole protection. Pasting a ::: into a container won't ruin things - the editor lengthens the note's fence so the paste doesn't close it; delete the line again and the fence shrinks back.

So,

```
:::note
Some text.
:::
```

turns into:

```
::::note
Some text.
:::
::::
```

so to speak. One thing: the widened fence is what gets saved, so after a reload the container simply is a `::::` container and stays one; the shrink-back only happens while it's live in the editor.
</details>

---

## Claiming a name

```ts
registerDirective(tier, name, definition);
```

A tier has to be passed in for registering, so a container and a leaf may share a name. A few things to know:

- **A duplicate register throws.** Same as `customElements`, same as every other registry in aragonite: no silent override. The second `registerDirective` throws on install, which is a rude way for your user to find out. If you want first-wins, opt into it yourself: check `isDirectiveRegistered(tier, name)` and skip your registration when the name is taken.
- **Binding a name to a kind.** You declare a kind as usual (see plugin guide); registerDirective binds a name to it and, for containers, gives it a fromDirective that builds your node from the parsed fence. e.g.

```ts
registerDirective('container', 'note', {
	kind: NOTE, // the kind you declared
	fromDirective: (parsed) => {
		// how to build one from a ':::note' fence
		const node: CstNode = {
			kind: NOTE,
			leadingTrivia: parsed.leadingTrivia,
			raw: parsed.raw,
			innerPrefix: parsed.body?.prefix ?? '',
			// the title rides as child 0 (a chrome leaf; see the plugin guide)
			children: [chromeChild(NOTE_TITLE, parsed.fence.info.trim()), ...(parsed.body?.children ?? [])],
			innerSuffix: parsed.body?.suffix ?? ''
		};
		setPluginMetadata(node, {
			name: parsed.fence.name,
			// the four fence fields createDirectiveRebuild needs, under these exact names
			colonCount: parsed.fence.colonCount,
			closerColonCount: parsed.closerColonCount,
			closerNewline: parsed.closerNewline,
			lineEnding: parsed.lineEnding
		});
		return node;
	}
});
```

- **Binding many names to one kind.** Name to kind is not a one to one relationship - it can be many to one. Say you want `:::note`, `:::warning` and `:::tip`, and they all behave the same (same component, same keymap, same collapse), differing only in colour and icon. Rather than declaring three kinds, declare one, call it callout, and register all three names against it:

```ts
registerDirective('container', 'note',    { kind: CALLOUT, fromDirective: build });
registerDirective('container', 'warning', { kind: CALLOUT, fromDirective: build });
registerDirective('container', 'tip',     { kind: CALLOUT, fromDirective: build });
```

The factory (broadly, a function that takes the parsed pieces of a fence (its name, info string, body, etc.) and builds the corresponding block's node) (aka fromDirective in this case) just keeps the name in the node's metadata so the component knows which one it is.

### When is `fromDirective` required?

`fromDirective` is required, optional or refused depending on the tier (and yes, it fails loud):

| Tier      | `fromDirective` | Why                                                                                    |
| --------- | --------------- | -------------------------------------------------------------------------------------- |
| Container | required        | a container has to build its own node, or the generic rebuild has nothing to work with |
| Leaf      | optional        | without one, the leaf just restamps its kind; with one, you build the node             |
| Text      | refused         | inline nodes are kind-only; a factory would never be called                            |

p.s. Please, for chrissake, don't hand-write `rebuildRaw` for a container, lest you enjoy watching a car crash. `createDirectiveRebuild` does all of it; the plugin guide's walkthrough shows it in use.

## The info string and attributes

Everything after the name on the opener line is the **info string**. It is captured verbatim (leading space included) and written back verbatim; nothing ever re-parses it to rebuild the bytes.

If you want the remark-style `[label]{#id .class key=value}` convention, `parseDirectiveAttributes(info)` reads it into `{ label, id, classes, properties }`. It is opt-in and pure: a directive whose "info" is just a title (`:::note My Title`) never calls it.

One limitation though: the helper goes one way, info to structure, not the inverse. A directive that edits its attributes rewrites its own info string (through its metadata and `rebuildRaw`, the same path a title edit takes). If a real plugin needs the inverse, it is an additive addition; raise an issue and present your case.

## Switching it on

Directives ship inert. `activateDirectives()` turns the grammar on (the generic boxes, the `:::` and `::` block openers, and the inline `:` recognizer).

Remember, call it once at startup, before the editor first parses anything (a document parsed before the call will not re-parse, and a dev-mode warning will call you out). The call is also idempotent, so several plugins (and hot-reload re-runs) can each make it without stepping on each other. And it really is the call that does it: importing authoring symbols off `@voithos-labs/aragonite/plugin` claims nothing, so a plain-GFM consumer who never calls it keeps `:::` as ordinary text.

## What you get on `@voithos-labs/aragonite/plugin`

Everything here is marked pre-freeze, meaning it may still change shape until 1.0.

The ones you will actually use:

| Entry                    | When you reach for it                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activateDirectives`     | once, at startup, to turn directives on at all                                                                                                                             |
| `registerDirective`      | to claim a name for your kind (this whole page)                                                                                                                            |
| `isDirectiveRegistered`  | to check whether a name is already taken, if you want first-wins instead of a throw                                                                                        |
| `createDirectiveRebuild` | to get a `rebuildRaw` for your container without writing one (the thing you were told not to hand-write); it assumes your child 0 is the editable title on the opener line |
| `DIRECTIVE_BODY_WRAP`    | put it in your container kind's `bodyWrap`; it tells the parser how a `:::` body is wrapped in blank lines                                                                 |

The ones you probably won't:

| Entry                      | When you reach for it                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `parseDirectiveAttributes` | if your info strings use the `[label]{#id .class key=value}` convention and you want them read into an object |
| `serializeDirective`       | writes a fence back out, byte for byte; `createDirectiveRebuild` already calls it for you                     |
| `escalatedColonCount`      | how many colons a fence needs to hold a given body; only if you build `:::name` text by hand                  |

Plus the types: `DirectiveTier`, `DirectiveDefinition`, `ParsedDirective`, `DirectiveFence` and `DirectiveAttributes`.

The one type worth knowing by heart is `ParsedDirective`, because it is what your `fromDirective` gets handed:

| Field                                             | What it is                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fence`                                           | the opener line, taken apart: `tier`, `colonCount`, `name`, `info`                                                                                 |
| `body`                                            | everything between the fences, already parsed (a leaf has none); its `children` become your node's body blocks                                     |
| `leadingTrivia`, `raw`                            | the blank lines before the block, and the block's exact source text; copy both onto your node untouched, or it will not save back to what was read |
| `closerColonCount`, `closerNewline`, `lineEnding` | how the closing fence looked and which line ending the file used, so the fence can be written back exactly, CRLF included                          |

One thing to know before you write your metadata type: `createDirectiveRebuild` needs it to carry `colonCount`, `closerColonCount`, `closerNewline` and `lineEnding`, under exactly those names. Those four are how it writes the fence back identical to the one it read. The compiler will tell you if one is missing; now you also know why.
