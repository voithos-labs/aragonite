# Feature: block openers under a marker-hiding mode

A block whose only bytes are its own chrome has nothing to stand behind that chrome, so the chrome
paints: `live` and both `preview-*` rungs show a content-empty construct's markers dimmed, exactly
as source mode shows them, and every edit against them behaves as source mode's does. `reading` is
unchanged — it takes no keystrokes, so an empty construct there is still allowed to paint nothing.

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
- Backspace at the START of a painted `# ` (raw 0, reachable only because the chrome paints) drops the whole construct in one undoable press, the same claim the kind makes at a non-empty heading's content start.

## Miss-analysis

- The live requirement families covered typing into paragraphs and typing at hidden INLINE edges, and the destructive side pinned that a construct-edge delete drops the whole `# `. No scenario typed a BLOCK opener, so the path that MINTS a marker-only block had zero coverage while the path that refuses to leave one behind was pinned.
