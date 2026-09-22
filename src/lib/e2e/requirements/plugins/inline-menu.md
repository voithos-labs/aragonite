# Feature: inline menus

A list the editor opens under the caret while the author types after a trigger: `#` for a tag,
`[[` for a link to another document. A source registers the trigger and supplies the items
(`editor.inlineMenus.addSource`, or `getInlineMenus()` on the host's instance); the editor owns
the rest, because it is the part a host cannot do from outside without racing the editor:
noticing the trigger as the bytes are typed, holding the navigation keys while the list is up,
anchoring to the typed range, and replacing that range with the pick as ONE undo entry.

The caret never leaves the document. The list takes no focus, so the author keeps typing the
query, and an empty list holds no key at all.

Seed `inline-menu` installs two plugin sources at once: tag autocomplete over the document's own
tags (`src/routes/demo-tags/tag-marks-plugin.ts`, synchronous) and a document picker on `[[` whose
list arrives asynchronously (`inline-menu/doc-link-menu-plugin.ts`), the shape a host's wikilink
menu takes. The page itself registers a third, a `/` command list (`inline-menu/slash-menu-source.ts`)
whose pick inserts a block: `insert` is empty and `onCommit` goes through the instance's
`insertMarkdown`, the shape a slash-command menu takes.

## Opening

- Typing the trigger opens that source's list under it; the rows are the source's, in its order.
- The query narrows the list as it grows, and widens it again on Backspace.
- A caret that merely ARRIVES beside an existing trigger (a click, an arrow key) opens nothing.
- A trigger the source declines by position opens nothing: a mid-word `#` is not a tag.
- A trigger typed inside an inline code span opens nothing: it is not syntax there.
- With two sources installed, `[[` opens the picker and `#` the tags, never each other's.
- It works in a list item, not only a top-level paragraph, and on a line just started with Enter.
- Typed as fast as a keyboard goes, the trigger still opens: the editor publishes a burst of
  keystrokes as one change, and the query's first bytes may arrive in the same change as the trigger.

## Keys

- ArrowDown / ArrowUp move the active row and wrap; the caret does not move and no byte changes.
- Enter commits the active row. Tab does too.
- Escape closes the list and leaves what was typed; typing on does not reopen it.
- A query that matches nothing hides the list and releases the keys: Enter is the author's own
  Enter again, and splits the block.
- A composition takes the keys back: composed bytes reach the document only when the IME commits
  them, so the caret steps out of the query and the session ends, and the Enter that closes the
  candidate window commits no row.

## Commit

- The pick replaces the trigger AND the query, and the caret lands after it: typing continues
  the line.
- One undo restores the typed query; the pick was one entry.
- A click on a row commits it, and the document keeps its caret (the press does not blur).
- An asynchronous list settles on the last query typed. (A slow answer a later keystroke
  superseded being dropped, and its signal aborted, is pinned in the unit battery, which can hold
  a promise open; the fixture keeps no timer.)

## Closing

- A query the source does not accept ends the session: a space ends a tag.
- Moving the caret out of the query closes the list.
- Focus leaving the editor closes the list.

## Opening by name: a shortcut or a button

- `open(name)` types the trigger at the caret and opens the list there, exactly as if typed.
- It opens where the typed trigger would have been declined by position: the gesture is the
  author's say-so.

## A block through onCommit

- `/` on a fresh line opens the command list, the query narrows it, and the pick removes `/` and
  the query while the document gains the block `onCommit` inserted.
- A `/` inside a word opens nothing: a path or a date is text.

## Host signal

- `menuChange` fires `true` when the list appears and `false` when it goes, so host chrome over
  the caret can step aside.

## Error cases

- zero `[invariant:…]` console fires across the battery (asserted through `capturedErrors`)
