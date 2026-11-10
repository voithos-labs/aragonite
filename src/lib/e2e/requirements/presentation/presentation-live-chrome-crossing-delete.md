# Feature: live-mode deletes out of a titled container close the runs they cut

A selection that starts inside a container with a reserved title row and leaves
it cuts through whatever format run it starts in, and the run's closing delimiter
goes with the deleted range. Where the text after the range can join (a paragraph
below), it joins the body paragraph inside the container, which keeps its closing
line. Where it can't (a code block, a table), the body paragraph is cut where it
stands. Both ways the contract is `live-mode.md` § 4.5's: a run the cut went
through closes on the kept head, so no literal `**` paints, while the title row's
own raw writes stay byte-literal. Driven on `/test/plugins` (callout seed) switched
to live through the bridge; the source bridge is what each scenario checks against.

## Happy paths

- select from inside `**bold**` in a callout body paragraph to the start of the
  paragraph below the callout, Backspace: that paragraph's text joins the body
  inside the callout, behind the closed bold (`Some **bo**Below`), the callout's
  closing line stays, and no delimiter is on screen
- select from inside `**bold**` out of the callout into the middle of a code
  block's text, Backspace: nothing joins, the kept head reads `Some **bo**`, still
  bold, with no delimiter on screen, the callout keeps its closing line and the
  code block keeps its opening line and the text after the range

## Edge cases

- source mode keeps the cut byte-literal, and an endpoint in the title row
  stays byte-literal even in live mode (both pinned by the range-edit core's rows in
  `range-edit/named-rows.ts` and its law that a cut pasted back gives the source back)

## User interactions

- the selection starts at a real click and grows by real Shift+Arrow keypresses,
  or into the middle of the code block by a real Shift+click, and the delete is a
  real Backspace, because the cleanup lives under the cross-block delete dispatch

## Error cases

## Miss-analysis

The fix for the table branch pinned its own prose truncations, but no spec
selected across a container wall without a table, which is the sibling branch
that skipped the cleaner in exactly the same way.

Once every range removal went through the range-edit core, the one scenario here
began to join the paragraph below, so it no longer reached the cut with no join.
The code block scenario holds that case with an end block no text joins.
