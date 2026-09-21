# Feature: block openers under a marker-hiding mode

A block whose only bytes are its own markers has no content for them to stand in front of, so the
markers paint: `live` and both `preview-*` modes show a content-empty construct's markers dimmed,
exactly as source mode shows them, so a caret can land on them and a typed byte goes after them. A
destructive key at the block's own structure still follows the mode; one at an inline construct
follows what is painted, since a painted delimiter is a byte the user saw. `reading` is unchanged:
it takes no keystrokes, so an empty construct there is still allowed to paint nothing.

## Typed openers (live)

- `#` typed into an empty paragraph: the block becomes a heading and its `#` paints, at the paragraph's size rather than the h1's. The heading type arrives with the space after the hashes and never before: the bare `#` is CommonMark's empty heading, but to a user it is the first byte of `#tag`, and a line that jumps to h1 size for that one keystroke reads as the editor fighting the tag.
- a letter typed after that `#`: the byte lands after the marker (`#a`), and the block reads back as a paragraph.
- a space typed after that `#`: the source is `# `, the block is still a heading, the markers still paint, and the h1 type is on now that the opener is complete.
- a letter typed after `# `: the source is `# a` and the markers hide, because the content they stand in front of arrived.
- three backticks typed into an empty paragraph: the block becomes a fenced code block, completes its closer, and offers the language picker.
- an info string typed into that picker and committed with Enter: the bytes append after the fence (` ```js `), never in front of it, and the caret returns to the body. A fence with a body line keeps its backticks hidden; the next typed byte lands in the body.

## Loaded openers

- a document holding a bare `#` and an empty fence is silent in live while neither is focused. Focusing the heading paints its marker; focusing the empty fence completes it with a body line and offers the language picker, so a caret never sits on an invisible line.
- the preview modes behave the same, on the focused block only.
- reading mode paints neither.

## Destructive parity

- Backspace inside a painted `# ` takes the marker byte as source mode would, and does not demote the block: the demote handler reads the bound the offset traversal can land on, which now follows what is painted.
- Backspace at the start of a painted `# ` (raw 0, reachable only because the markers paint) drops the whole construct in one undoable keypress. In source mode raw 0 is a key that does nothing today, so this is a live-only outcome the painting made reachable, not parity with source.

## Painted inline markers (`[](u)`, live and source alike)

- `End` then Backspace takes exactly one byte, leaving `[](u`: the delimiters are on screen, so no keypress may take them as a run the user never saw.
- `Home` then Delete takes exactly one byte, leaving `](u)`.
- a letter typed at `End` appends (`[](u)a`), the rule for where typed bytes go taking nothing where no run is hidden.
- each of the three matches source mode byte for byte, since what is painted is what the two modes now agree on.

## The live rewrites against painted markers

Every rewrite that builds candidate bytes for a marker-hiding mode meets this block too, and each
must leave the painted bytes alone: what the user can see is not a run a rewrite may drop, move
or wrap.

- a letter typed between `]` and `(` lands exactly there (`[]a(u)`), in live as in source: no rule for where typed bytes go takes a painted delimiter.
- Enter between `]` and `(` cuts the bytes literally, leaving `[]` above `(u)`, and the rebalancer writes no closer or opener over markers the user saw.
- a pending bold toggle then a letter at the same caret writes no delimiter into the painted markers.
- Backspace at the start of the paragraph below concatenates the two blocks literally (`[](u)para`), the join dropping nothing.
- the link card, entered with the caret inside the painted markers, still rewrites the destination they are showing.

A construct wrapping content-empty markers (`**[](u)**`) paints all nine bytes, and the caret can
step between the outer pair and the inner one precisely because they paint. The two rewrites that
run across a cut meet the painted pair there, and neither may treat it as a run the user never
saw:

- a range delete from between the two pairs into the paragraph below leaves the painted `**` standing, exactly as source mode does.
- Enter at the same caret cuts the bytes literally, leaving `**` above `[](u)**`, rather than carrying the painted opener into the second half.

## Miss-analysis

- Heading styling was asserted on blocks whose opener was already complete, so no scenario held
  the one keystroke where the bytes are a bare `#` and the parser already calls the block a
  heading, the moment a `#tag` flashes through.
- The live requirement files covered typing into paragraphs and typing at hidden inline edges, and the destructive side pinned that a construct-edge delete drops the whole `# `. No scenario typed a block opener, so the path that creates a marker-only block had zero coverage while the path that refuses to leave one behind was pinned.
- The construct-edge delete handler was only ever exercised against blocks holding content, where its delimiters really are hidden. No destructive scenario ran inside a content-empty block, so the handler consulted a reference answer that reports every marker as unseen while the screen showed all five bytes.
- Only the destructive handler was pinned against painted markers. The other five rewrites reach the same block and answer correctly only because that wrong reference answer cancels against their own check, so nothing would have failed the day one of them stopped canceling.
- Every painted-marker scenario used the flat `[](u)`, which the split and the join both decline because it has no children, which is the wrong reason. No fixture wrapped those markers in a construct the two rewrites do cut open, so their conservation check kept reading nine painted bytes as bytes nobody saw.
