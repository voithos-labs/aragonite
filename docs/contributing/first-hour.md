# The first hour

You've cloned the repo and you'd like to be useful within the hour. This page is what to read in that hour, in order, with a sentence on why each, then the five things a first change nearly always touches and the file each one lives in. The minutes are proportions, not a promise; some of you read faster than me.

It replaces nothing it points at. If you already know the codebase, you're in the wrong doc.

## The hour

1. **The root `README.md`, § Lossless. Ten minutes.** The one idea everything else follows from: the parser cuts your Markdown into a tree whose every node keeps its own slice of the original bytes, markers included, and saving glues the slices back together. Read that section and stop. The rest of the README is the pitch, and it'll still be there tomorrow.
2. **[`rules.md`](rules.md). Ten minutes.** Five rules, each paid for by a bug that cost someone a document, and the ladder that says where a rule should live so nobody has to remember it. You'll forget one. Read it anyway.
3. **[`../design/editor.md`](../design/editor.md), §§ 1 to 3. Fifteen minutes.** The shape of the thing: the parse, render, serialize loop, the components that run it, the six terms the rest of the docs lean on, and how an edit travels from a block to the tree and back to the screen. Stop at § 4. Everything after is per-subsystem reading, for when a task touches that subsystem.
4. **[`glossary.md`](glossary.md). Five minutes.** Skim it once so the words register, then keep it open in a tab. The code comments still use a few dozen words the repo coined, and every one of them is a line there.
5. **[`codebase-map.md`](codebase-map.md), the top and the keyboard section. Five minutes.** Not the big table, not yet. Read how a row works, so that when something breaks you know the map exists and what a row hands you (the file to open, and the rule people keep breaking there).
6. **Run it. Fifteen minutes.** Node 24, then:

   ```
   npm install
   npx playwright install chromium
   npm run dev
   ```

   The second line isn't optional; the e2e suite and the perf gate both drive chromium. Open `/test/editor`, type a list, nest an item, undo it. Then `Ctrl+Shift+D` (`Cmd+Shift+D` on a Mac) opens the debug panel: watch the CST section (the parsed tree) change as you type, and notice the raw source next to it is the bytes you typed, `- ` and all. That's the whole architecture, live. Then run the area suite you'll spend the most time in, say

   ```
   npm run test:editor:cursor
   ```

   (any `test:editor:<area>` script in `package.json` works), and read two of the files it ran. Matching their conventions is half of a good first pull request, and [`testing.md`](testing.md) has the other half.

## The five things you'll touch first

Open the file; read the doc when the file raises a question it doesn't answer.

| You want to change                                                                                                                                                                                                                                                               | Open                                                                                                                                                                                                                                                                                     | Then read                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A keystroke.** A typed character goes through the block's editable surface (the contenteditable element plus the code that owns it) and enters the tree at exactly one place. A command key (Enter, Backspace, `Mod+B`) resolves to a named command through the keymaps first. | `src/lib/components/blocks/editable-surface.ts` :: `createEditableSurface`, then `src/lib/tree-operations/content-write.ts` :: `updateNodeContent`. For a command key, `src/lib/schema/commands.ts` :: `resolveBinding`, then `src/lib/schema/block-commands.ts` :: `dispatchKeyCommand` | `docs/design/editor.md` § 6 for typing, § 5 for commands, and `docs/contributing/codebase-map.md` § Keyboard and chords for where a new key goes |
| **A click.** The browser places the caret inside a text block. The editor decides everything around that: a click on the margin, beside an image, on a formula, between two tables.                                                                                              | `src/lib/selection/dead-space-caret.ts` for a click outside any text; `src/lib/components/blocks/text/widget-interaction.ts` :: `snapClickToWidgetEdge` for one beside a widget                                                                                                          | [`../design/caret-placement.md`](../design/caret-placement.md): the whole click, nine stages, one file each                                      |
| **A paste.** One parse-and-route path, whatever the clipboard held.                                                                                                                                                                                                              | `src/lib/tree-operations/paste/dispatch.ts` :: `pasteDispatch`                                                                                                                                                                                                                           | `docs/design/editor.md` § 10                                                                                                                     |
| **A block kind.** A kind is the string on a node that says what block it is (`paragraph`, `table`), and everything the editor knows about one is its descriptor, the per-kind metadata record: how it merges, focuses, serializes.                                               | `src/lib/schema/block-kind-descriptor.ts` for what a kind declares; `src/lib/core/nodes.ts` for the node union a built-in kind joins                                                                                                                                                     | [`adding-a-block.md`](adding-a-block.md) for a built-in kind; a plugin's kind is the row below                                                   |
| **A plugin.** The whole authoring API sits on one import path, and the nine bundled plugins are built on exactly what a third party gets, so copy one.                                                                                                                           | `src/lib/plugin.ts`, then a bundled plugin under `src/lib/plugins/` (the parrot is the one the plugin guide builds first)                                                                                                                                                                | [`../guide/plugin-guide.md`](../guide/plugin-guide.md), then [`../guide/plugin-testing.md`](../guide/plugin-testing.md)                          |

## Before your first pull request

[`rules.md` § Before you open the PR](rules.md#before-you-open-the-pr): six checks, six commands, seconds each. And if you want to see a whole change here before making one, [`anatomy-of-a-change.md`](anatomy-of-a-change.md) traces one feature from its first design decision to ship, including two tests that passed for the wrong reason.
