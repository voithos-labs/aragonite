# Feature: Perf A/B, gestures timed on several builds

`scripts/ci/perf-ab.mjs` runs `gestures.spec.ts` against each compared build's production preview. It prints numbers and gates nothing. Without `PERF_AB_URL` and `PERF_AB_RESULTS` every row skips.

## Happy paths

- Each row loads its document, takes one unmeasured sample, then times each sample in the page from the key's keydown to the frame after the tree first changes.
- A row with a key names the plain key it is ruled to cost the same as, and the table prints the ratio to it on the same build.
- Over a range from the middle of one paragraph to the middle of the paragraph two below, in 1 MB of small paragraphs: Delete (the key of every row here), Backspace, a typed letter, a paste of one line, a paste of two paragraphs, Enter and Shift+Enter, each undone before the next sample.
- Over a divider held whole and the two paragraphs under it, to the second one's end, in the same document with its middle block a divider: Delete (the key of every row here), a typed letter, Enter and a paste of one line. No text is kept at either end, so the text and the break take a line of their own.
- At a caret in the same document: a letter typed mid-paragraph (the control), Enter at a paragraph end, a paste of two paragraphs mid-paragraph and a paste of two lines at a paragraph end.
- A letter typed at the end of the first block among small blocks and in flat prose, in the first item of a giant list, at the end of a 60-line code fence in live mode, and at the end of a paragraph dense with footnote references and `[[wiki]]` links on `/test/plugins?seed=footnotes`.
- At an item end in a 1 MB bullet list: Enter, a second Enter on the item the first opened, a paste of `x\n` (key: Enter) and a paste of `x\n\n` (key: the two Enters). In a numbered list: Enter, and a paste of `x\n` (key: Enter).
- A row labelled "main-thread ms" reads Chromium's main-thread time (`Performance.getMetrics`) from just before each key to the frame after it, and keeps the frame timer's reading beside it.
- In a 200 KB document of plugin blocks on `/test/plugins`: a letter typed mid-paragraph in a plain paragraph (the control), a `:::note` body, a `> [!NOTE]` body and an open `<details>` body. On `?seed=footnotes`: in a plain paragraph and in a paragraph citing a footnote.
- In the same document on `?seed=hloccur`: 40 presses of ArrowRight from the start of a paragraph, a `:::note` body and a list item, each ending 41 characters in.
- The first mount of 392k short paragraphs citing footnotes, on a fresh page each sample: from the load to the frame after block 0 shows its first reference numbered 1 (`?seed=footnotes-ref`) or its text (`?seed=callout`).

## Edge cases

- A build whose bridge lacks a call a row makes, whose route draws no footnote reference, whose whole-block range reads back as another range, or whose first sample changes nothing or makes another edit reports the row as not on this ref, with the reason, instead of failing.
- A plugin row whose paragraph sits at the top level or in a quote (no plugin took the construct), or a move row with no occurrence marked, reports not on this ref.

## Error cases

- A range or caret edit that leaves other bytes than its own (whitespace aside) fails the row, and so do typed letters that land anywhere but in one run at the caret.
- A key that never reaches the page fails the row at its deadline, and so does a timed sample that changes nothing.
- Undos that don't put the document back byte for byte fail the row.
- A move row whose caret ends anywhere but 41 characters into its paragraph fails.
