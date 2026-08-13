# Feature: block openers under a marker-hiding mode

A block whose only bytes are its own chrome has nothing to stand behind that chrome, so the chrome
paints: `live` and both `preview-*` rungs show a content-empty construct's markers dimmed, exactly
as source mode shows them, so a caret can land on them and a typed byte seats after them. A
destructive key at the block's OWN structure still follows the mode; one at an inline construct
follows the paint, since a painted delimiter is a byte the reader saw. `reading` is unchanged — it
takes no keystrokes, so an empty construct there is still allowed to paint nothing.

## Typed openers (live)

- `#` typed into an empty paragraph: the block becomes a heading and its `#` paints on the h1 line.
- a letter typed after that `#`: the byte lands AFTER the marker (`#a`), and the block reads back as a paragraph.
- a space typed after that `#`: the source is `# `, the block is still a heading, the chrome still paints.
- a letter typed after `# `: the source is `# a` and the chrome hides — the content it stands behind arrived.
- three backticks typed into an empty paragraph: the block becomes a fenced code block and its fence line paints.
- an info string typed after that fence: the bytes append after the fence (` ```js `), never in front of it.

## Loaded openers

- a document holding a bare `#` and an empty fence paints both in live: no invisible line, no empty invisible box.
- the preview rungs paint the same chrome on an UNFOCUSED block, where they reveal nothing today.
- reading mode paints neither.

## Destructive parity

- Backspace inside a painted `# ` takes the marker byte as source mode would, and does not demote the block: the demote arm reads the walk's landable bound, which now reflects paint.
- Backspace at the START of a painted `# ` (raw 0, reachable only because the chrome paints) drops the whole construct in one undoable press — where source mode at raw 0 is a dead key today, so this press is a live-only outcome the paint made reachable, not source parity.

## Painted inline chrome (`[](u)`, live and source alike)

- `End` then Backspace takes exactly one byte, leaving `[](u`: the delimiters are on screen, so no press may take them as a run the reader never saw.
- `Home` then Delete takes exactly one byte, leaving `](u)`.
- a letter typed at `End` appends (`[](u)a`), the seat claiming nothing where no run is hidden.
- each of the three matches source mode byte for byte — the paint is what the two rungs now agree on.

## The live rewrites against painted chrome

Every rewrite that builds candidate bytes for a marker-hiding mode meets this block too, and each
must leave the painted bytes alone: what the reader can see is not a run a rewrite may drop, move
or wrap.

- a letter typed between `]` and `(` lands exactly there (`[]a(u)`), in live as in source: no seat claims a painted delimiter.
- Enter between `]` and `(` cuts the bytes literally, leaving `[]` above `(u)` — the rebalancer writes no closer or opener over chrome the reader saw.
- a pending bold toggle then a letter at the same caret writes no delimiter into the painted chrome.
- Backspace at the start of the paragraph below concatenates the two blocks literally (`[](u)para`), the join dropping nothing.
- the link card, entered with the caret inside the painted chrome, still rewrites the destination the chrome is showing.

A construct WRAPPING content-empty chrome (`**[](u)**`) paints all nine bytes, and the caret can
walk between the outer pair and the inner one precisely because they paint. The two seams that
rewrite across a cut meet the painted pair there, and neither may treat it as a run the reader
never saw:

- a range delete from between the two pairs into the paragraph below leaves the painted `**` standing, exactly as source mode does.
- Enter at the same caret cuts the bytes literally, leaving `**` above `[](u)**`, rather than carrying the painted opener into the second half.

## Miss-analysis

- The live requirement families covered typing into paragraphs and typing at hidden INLINE edges, and the destructive side pinned that a construct-edge delete drops the whole `# `. No scenario typed a BLOCK opener, so the path that MINTS a marker-only block had zero coverage while the path that refuses to leave one behind was pinned.
- The construct-edge delete arm was only ever exercised against blocks holding content, where its delimiters really are hidden. No destructive scenario ran inside a content-empty block, so the arm consulted an oracle that reports every marker as unseen while the screen showed all five bytes.
- Only the destructive arm was pinned against painted chrome. The other five rewrites reach the same block and answer correctly only because the oracle's wrong answer cancels against their own check, so nothing would have failed the day one of them stopped cancelling.
- Every painted-chrome scenario used the FLAT `[](u)`, which the split and the join both decline by childless arity — the wrong reason. No fixture wrapped that chrome in a construct the seams DO cut open, so their conservation check kept reading nine painted bytes as bytes nobody saw.
