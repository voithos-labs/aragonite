# Feature: inline menus

A list the editor opens under the caret while the author types after a trigger: `#` for a tag,
`[[` for a link to another document. A source registers the trigger and supplies the items
(`editor.inlineMenus.addSource`, or `getInlineMenus()` on the host's instance); the editor owns
the rest, because it is the part a host cannot do from outside without racing the editor:
noticing the trigger as the bytes are typed, holding the navigation keys while the list is up,
anchoring to the typed range, and replacing that range with the pick as one undo entry.

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
- A caret that merely arrives beside an existing trigger opens nothing, including one that lands
  in another block and walks up to a tag it never typed.
- A trigger the source declines by position opens nothing: a mid-word `#` is not a tag.
- A trigger typed inside an inline code span opens nothing: it is not syntax there.
- A trigger typed inside a link's destination opens nothing either, and the same holds for its
  title, for anywhere in an image, for an autolink and for raw HTML. A link's own text is prose,
  so a trigger there still opens.
- With two sources installed, `[[` opens the picker and `#` the tags, never each other's.
- It works in a list item, not only a top-level paragraph, and on a line just started with Enter.
- Typed straight after Enter with no keystroke of its own (a paste, an IME commit, a script's
  `insertText`), the trigger still opens: the baseline is taken as the bytes are about to land,
  not from the caret's arrival, which the browser announces a task later.
- Typed as fast as a keyboard goes, the trigger still opens: the editor publishes a burst of
  keystrokes as one change, and the query's first bytes may arrive in the same change as the trigger.

## What a screen reader is told

- While rows show, the editable the author is typing in reads as a combobox: it says the list is
  expanded, names the list, and names the active row, which changes as the arrows move it.
- The active row is named after itself, so a query that narrows the list to one row leaves the
  editable naming that same row rather than whatever now sits first.
- Escape takes all of that back: the editable is a plain text box again.

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

- The pick replaces both the trigger and the query, and the caret lands after it: typing
  continues the line.
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

## Miss analysis

The Enter-then-type cases passed while the baseline came only from a keydown or from the caret's
arrival: the harness's bridge reads between the two gave the browser's selection change time to
fire first. Run back to back, the arrival lost that race to the typed burst on a third of runs,
and no case typed without a keydown except the ones that also waited.

Every case read the list's own markup and none read the element the author types in, so the
editable could say nothing at all about the list and the suite still went green.

The only position ever excluded was an inline code span, so the other bytes a reader does not read
as prose, a link's destination and title, an image, an autolink, raw HTML, were never asked about.

The arrival case stayed in the block it had just typed the trigger into, so the caret it tested
was the typist's own coming back, never one reaching a trigger it had never typed.

Every case that read what the editable names moved the active row with the arrows, which moves the
row's place in the list along with it, so nothing asked what a narrowing query does, where the row
changes under a place that does not.
