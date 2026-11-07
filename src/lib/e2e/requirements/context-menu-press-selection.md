# Feature: The right-click menu reads the selection from the press

Safari selects the word, line break or whole element under a right-click before it sends
`contextmenu`. The editor decides which menu to open on whether the right button's press landed on
a selected range; what the clipboard rows act on (Cut and Copy, the Paste target) stays the live
selection, so Paste replacing a right-clicked word works as a native macOS right-click does.
The rows model Safari by setting the selection between a dispatched press and `contextmenu`, since
Playwright's WebKit off macOS selects nothing on a right-click. The press is fired as an engine fires
it: a pointerdown, then a mousedown only if no block cancelled the pointerdown.

## Happy paths

- A right-click after Safari's own select opens the menu a real right-click opens on an engine
  that selects nothing, for every target: a word in prose, in a link, in an autolink, in code and
  in a cell, a divider, an inline image (selected or not), a tag, a wikilink in prose and in a
  cell, an inline equation, an emoji, a footnote reference, a plugin's widget in prose and in
  a cell, an image in a list item, a quote and a details body, and a footnote reference inside a
  footnote definition.
  - A word Safari selects in text the clipboard rows act on (prose, a link or an autolink, a cell) stays
    selected, with Copy enabled, and Paste replaces it.
  - A selected image the editor holds stays held, with Copy enabled.
  - Anywhere else (code, a divider, any other inline widget) the caret at the press replaces
    Safari's select, so a widget that goes somewhere offers Edit link and Cut and Copy are off.
- A real right-click inside a selection keeps it: the clipboard rows act on it, with no Insert
  flyout. A range the editor holds across blocks follows the same two rules (`context-menu-range.md`).
- A right-click on a widget the editor holds selected (an image, a chip in prose or in a cell),
  real or after Safari's own select, keeps it held, with Cut and Copy on, and the rows act on it as
  Ctrl+X, Ctrl+C and Ctrl+V do: Copy carries its bytes and a paste elsewhere gives it back, Cut
  takes it out, Paste replaces it.

## Edge cases

- A press outside text selected elsewhere opens the block actions of the block under it, whether
  Safari then selects a word there or the browser collapses the old selection first, as Chromium
  and WebKit do on a plain page.
- Every menu Paste route (prose Paste, Paste as plain text, Replace with clipboard, the cell's
  Paste) reads the clipboard only once its menu has left the page, so Safari's own Paste prompt
  never draws over an open menu.
  - The selection toolbar a word Safari selected brings back may stand at the read: it is no menu
    the pick came from.
- A click on a widget that shows its source, between two right-clicks, ends the first one: a
  right-click on another such widget then opens the menu its own press makes, with the caret at the
  press and the Insert flyout.

## Miss-analysis

- The divider's and the code block's actions were unreachable by right-click in Safari (#745)
  because the menu read the selection at `contextmenu`, and no browser the suite drives selects
  under a right-click.
- The Paste prompt drew over the menu because each pick closed its menu by a state write and read
  the clipboard before the page updated; no row looked at the page when the read began.
- A right-click on a tag or a wikilink offered no Edit link in Safari (#756): Safari selects the
  widget whole, the rows modelled its select only as a word or a block, and the cell menu never
  asked about the press.
- In Firefox the prose Paste, Paste as plain text and cell Paste pasted nothing (#746): each
  handed its text over as a constructed paste event, whose `clipboardData` Firefox empties. The
  suite ran on Chromium alone, which keeps it.
- On every engine a right-click on a widget that shows its source (a tag, a wikilink, an equation,
  a footnote reference) gets no mousedown, since the block cancels the pointerdown, so the menu
  read whatever right-click came before. The rows dispatched a mousedown no engine fires there.
- A right-click on a selected image or chip dropped it, and the menu's Cut and Copy stayed off:
  the rows read the browser's range, which a held widget never has, the editor's press-outside
  check ended the hold on any press, and no row right-clicked a widget the editor held.
