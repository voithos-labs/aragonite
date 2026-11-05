# Clipboard: the range-edit laws in a browser

The unit suite checks the range-edit laws through jsdom's stand-in events (`src/lib/test/range-laws/`). These rows run a fixed set of the same cases with real keys, a real clipboard and the real menu, and expect the same bytes, so a route jsdom fakes badly shows up here. The cases live in `src/lib/e2e/range-law-cases.ts`, which both runs read. A row the editor fails today pins what it does now beside what the law says, and both runs expect the pin until a fix deletes it.

## Happy paths

- A word copied, cut and pasted back inside a paragraph: the clipboard holds the word and the paragraph comes back as it was.
- A cut through a bold run in live mode, pasted back: the paragraph comes back byte for byte.
- Backspace over a range across two paragraphs: leaves the bytes a cut of that range leaves.
- Paste as plain text into a paragraph: the Markdown in the text is escaped, so it reads as typed.
- Paste as plain text into a code block inside a list item: the text goes in as is.

## Edge cases

- A cut across two paragraphs, pasted back: the document comes back (fails today, #818).
- A copy from a paragraph into a nested quote: the clipboard keeps the quote markers of the lines it covers.
- A cut from one nested list item into the next, pasted back: the list comes back (fails today, #818: the paste back splits the joined item).
- A key typed over a range that ends at a picture: replaces the range, as a cut then the key does.
- Two paragraphs pasted with `insertMarkdown` in the middle of a paragraph: the first joins the text before the caret, the last the text after (fails today, #818).
- A cut across paragraphs of a CRLF document, pasted back: the document comes back with its CRLF endings (fails today, #818).
- A range inside one live paragraph, put down with `setSelection`: `getSelection()` reads it back unchanged.

## User interactions

- Right-click inside a range across paragraphs, then Cut: the clipboard holds the range and the two halves join (fails today, #820: the menu drops the range and shows Cut disabled, in jsdom and every browser).
- An IME composition over a range across paragraphs (Chromium, over CDP): replaces the range, as a cut then the composition does.
- Paste at a caret, then Ctrl+Z: the bytes come back and the caret sits where the paste began.
- A word dragged and dropped at the end of the next paragraph: the bytes a cut of the word, then a paste at the drop point, leave. Skipped in Firefox, where Playwright’s drag never sends the drop.
