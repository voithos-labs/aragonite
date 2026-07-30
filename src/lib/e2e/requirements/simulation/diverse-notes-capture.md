# Feature: Diverse-notes capture (note-taking simulation)

Several longer, more diverse note sessions than the headline biology note, each
driven entirely through real keyboard, mouse, and clipboard input from an empty
document and guarded by the full harness oracle suite. They surface bugs over
constructs the biology note avoided, and some deliberately place a previously
blind-spot construct into their **equality spine** so typing ≡ loading guards it on
every run: dense inline variety (feature-tour), deep container nesting (project-plan),
a three-level outline (outline), a nested `> >` blockquote (reading-notes — the
regression spine for the nested-blockquote-exit fix), plus two genre notes
(meeting-minutes, README). Gated behind `SIM_CAPTURE` so they stay out of the default
suite; each records a screenshot + state manifest per structural unit for an agentic
visual review.

## Happy paths

- feature-tour note builds inline-rich prose char-by-char — ATX H1/H2 sections,
  multiple paragraphs, bold, italic, bold-italic, code spans, several links,
  strikethrough, bare-URL and bare-email autolinks, HTML entities, backslash
  escapes, a trailing-backslash hard line break, plus a bullet list and an ordered
  list; end-state equals the canonical note (typing ≡ loading)
- project-plan note builds structurally-deep content char-by-char — two-level
  nested bullets, an ordered list with a nested ordered sub-item, a mixed
  checked/unchecked task list, a multi-line blockquote, a fenced code block,
  several headings, and a resized image; end-state equals the canonical note
- outline note builds a three-level nested bullet list via the deep-nesting cadence
  (type item → indent the empty trailing item → type the fresh item); the
  three-level structure is in the equality spine, so a nesting regression fails
  end-state equality
- reading-notes note builds a nested `> >` blockquote (typed `>` then `>` then body);
  the nested quote is in the equality spine — the regression guard the
  nested-blockquote-exit fix shipped without
- meeting-minutes note builds headings, attendee bullets, a decision blockquote, an
  ordered agenda, and a task list with a nested action item; end-state equals the
  canonical note
- README note builds a link-bearing intro, ordered steps with inline code, a fenced
  code block, and a links section; end-state equals the canonical note
- each session records one screenshot + manifest entry per completed structural
  unit, plus the post-build `note-built` and `detour-done` checkpoints; the
  manifest lands at a seed-derived directory so a second run overwrites identically

## Edge cases

- hard line break round-trips: Shift+Enter inside already-typed text stays one
  paragraph (`a\\\nb`) and re-serializes to itself. It closes the feature-tour note:
  the gesture reaches backward into typed text and leaves the caret mid-block, and
  Shift+Enter at the block end would leave the backslash trailing rather than break
  the line
- Enter separates: a paragraph split leaves a blank line between the halves, so the
  built source reparses to the same block structure the session shows
- HTML entities and backslash escapes survive verbatim — the live parser styles
  them but the source bytes are unchanged on round-trip
- multi-paragraph blockquote: a single Enter inside a quote adds a `>` blank line
  and starts a second quoted paragraph
- nested-list cadence: an item is typed at its creation level then indented, and
  the empty trailing item is outdented back to top level before the next item is
  typed
- deep nesting reaches three levels via press-Enter → indent-the-empty-item →
  type-fresh-item; indenting the empty item produces no source delta, so the gesture
  settles on the focused item's path lengthening
- nested blockquote exit: building and round-tripping a `> >` nested quote leaves no
  stranded empty `> >` continuation line (the reading-notes spine guard for the
  exit-collapse fix)
- task toggle flips the first checklist item from unchecked to checked via a real
  checkbox click; the resulting `[x]` matches the canonical note

## User interactions

- typing uses per-character keyboard events; structure markers (`#`, `-`, `1.`,
  `**`, `*`, `` ` ``, `~~`, `[`, `>`, ` ``` `) are typed literally and the live
  parser forms the styled spans and blocks
- list nesting uses real Tab / Shift+Tab; the multi-paragraph blockquote uses a real
  Enter-then-type continuation; the image uses a real widget click then Shift+Arrow
  resize
- jump back to edit an earlier section: a real pointer click repositions into the
  first top-level block, the focus block path must equal the target, then a single
  char is typed and backspaced out (a wrong-block landing is a hard failure)
- undo / redo use real cross-platform shortcuts around a forced batch boundary; the
  transient edit is dropped so each note ends in its clean built state

## Error cases

- no console or page errors fire across either whole session
- nested BlockListState stays consistent (`auditBlockListStateConsistency` finds no
  container id/ref desync) at every oracle checkpoint, including across list nesting,
  the multi-line blockquote, and the list exits
- the live serializer round-trips the current CST at each oracle checkpoint
- the undo/redo differential restores the exact pre/post source around a forced
  batch boundary
- both sessions are deterministic: the asserted end-state and captured artifacts are
  identical across repeated runs of the same seed
