# Feature: Container Block Editing

Blockquote editing and cross-container interactions (list inside blockquote, blockquote inside list). Single-container list behavior lives in `blocks/list-block.md`.

## Happy paths

- blockquote content editable: click into blockquote, type text, source updates with `> ` prefix
- blockquote source round-trips: editing inside blockquote preserves `> ` prefix structure
- blockquote with multiple paragraphs: multi-paragraph blockquote renders and edits correctly

## Edge cases

- blockquote double-Enter exit keeps caret visible: Enter to create empty line, Enter again exits blockquote with cursor in a usable block (regression: caret disappeared)

## Blockquote unwrap on Backspace (Rule U2)

- Single-paragraph blockquote: Backspace at offset 0 of the first paragraph lifts it out; blockquote is deleted because it becomes empty
- Multi-paragraph blockquote: Backspace at offset 0 lifts only the first paragraph; remaining paragraphs stay inside the (shrunk) blockquote
- Nested blockquote: Backspace at start of innermost content unwraps one level (inner blockquote dissolves, content stays inside the outer blockquote). Multiple levels need multiple presses
- Blockquote preceded by paragraph: no auto-merge with the block above — each press performs exactly one structural operation
- Backspace at non-zero offset: normal character delete, U2 does not fire

## Cross-container interactions

- Blockquote containing a list: Backspace at start of the list's first item runs U1 (list unwrap) against the inner list, producing a plain paragraph still wrapped by `> `. See `blocks/list-block.md` for the full U1 semantics (first-item unwrap, matching-type sub-list promotion, mismatched sub-list as separate block, ordered renumbering).

## Cross-container merge on Backspace

- Flat blockquote + following paragraph + Backspace at offset 0 of the paragraph: merge the paragraph's text into the blockquote's last inner paragraph. Caret lands at the join point.
- Multi-paragraph blockquote: merge happens into the last inner paragraph only; earlier inner paragraphs are untouched.
- Nested blockquote (`> > deep`): merge recurses into the inner blockquote; the deepest inner paragraph receives the merged text.
- Target is a heading (`> # Heading`): merge into heading raw; kind stays `heading`; text appended after existing heading content.
- Deepest inner leaf is opaque (fenced code, thematic break): fall back to move-focus. No tunneling past opaque leaves.
- Empty blockquote (all inner children got removed via earlier edits): fall back to move-focus.
- The merged paragraph's text is preserved verbatim including inline markers (`**bold**`, `` `code` ``, etc.).
- One Ctrl+Z after a successful merge restores the pre-merge state (both the target's raw and the deleted paragraph).
