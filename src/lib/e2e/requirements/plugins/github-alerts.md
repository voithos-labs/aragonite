# Feature: Plugin Admonitions, native GitHub alerts

A blockquote whose first line is exactly `> [!TYPE]` renders as a styled alert box, the shared
admonition frame styled by the alert type, with its GitHub bytes untouched and never rewritten
to `:::name`. The marker line is not editable content: it shows as the badge. Editing the body
rebuilds the container through the marker and keeps the `githubAlert` kind, and the bytes
round-trip. On `/test/plugins?seed=admonitions` the native alert is a `caution` (block 5), and
`note`/`warning` belong to the callout dogfood, so an alert typed from scratch uses `tip`.

## Happy paths

- a loaded alert renders styled: the seed's `> [!CAUTION]` mounts as a
  `.admonition[data-alert-source='github'][data-kind='caution']` box whose badge reads "Caution",
  and the source still holds the verbatim `> [!CAUTION]` bytes
- typing an alert from scratch, keystroke by keystroke: `>` turns the block into a blockquote and
  completing `[!TIP]` turns it into an empty alert with the caret in its body, so typing the body
  straight on, with no second Enter (which would leave the quote), lands a `githubAlert` root
  child whose body carries the typed text, with bytes reading `> [!TIP]\n> …`

## User interactions

- edit inside the body: placing the caret in the alert body and typing appends to the body, the
  container's raw text is rebuilt through the `> [!CAUTION]` marker, which is kept verbatim, the
  kind stays `githubAlert`, and the document round-trips stable
- undo after an edit: one `Ctrl+Z` restores the document as it was before the edit, byte for byte
- unwrap on Backspace: pressing Backspace at the very start of the alert body lifts the first
  body block out and drops the marker. No `githubAlert` is left, the content parses again as a
  plain block (what remains of a body of several blocks becomes a plain blockquote), and the
  bytes are never rewritten to `:::`
- merge inside on Backspace at a middle body block: pressing Backspace at the start of a body
  block that is not the first merges it into the body block above, through the container's
  `default-merge`, and the alert stays one `githubAlert` root with its marker intact, so the
  merge never escapes the alert
- reorder inside on Alt+Arrow: with the caret in a body block, Alt+ArrowUp and Alt+ArrowDown move
  that body block among its siblings inside the alert. The container keeps its `githubAlert`
  kind, its `> [!TYPE]` marker and its child count, the document's own blocks around it never
  move, so the alert itself never jumps, and one `Ctrl+Z` restores the order

## Edge cases

- the marker takes no caret: the badge is a static label, so focus lands in the body rather than
  on the marker
