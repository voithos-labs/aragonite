# Feature: a drawing's own link follows by the host's rule

A block type's drawing that holds a link of its own asks `ctx.follows(event)` whether a click or a
key follows it, so the link answers the click the host picked for links, as a link in the text
does. The harness is `routes/test/plugins/note-refs`'s `[[see …]]` box, which records each name it
follows.

Miss-analysis: new; before it a drawing read Ctrl and Cmd by hand, or followed every click.

## Happy paths

- The host's link click (Ctrl or Cmd held) on the link follows it, in live mode and in source mode.
- Reading mode: a plain click on the link follows it, and so does Enter on the focused link.

## User interactions

- A plain click on the link follows nothing in live mode or in source mode.
- A key that is neither Enter nor Space on the focused link follows nothing.
