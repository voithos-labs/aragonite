# Feature: links that follow on a plain click

`[[note]]` written in prose renders as a link carrying the note's name. The harness plugin
(`routes/test/plugins/wikilinks`) reproduces limestone's integration: a `[[` recognizer at
prefix-override priority, and a widget registered with `revealSource` and
`claimsActivationClick`. The seed's editor sets `linkClick: 'plain'`, the host's way of saying a
plain click follows a link, the way it does on a web page. The widget decides whether to act by
asking its `isActivationClick` prop, so these tests go through the same answer the editor uses.
Seed `wikilinks`: a link mid-prose in block 0, a plain place to type in block 1, and a Markdown
link in block 2.

## User interactions

- A plain click on a link is the activation gesture: the widget records it (a host opens the
  note), the link stays mounted and the source doesn't change.
- Ctrl/Cmd-click activates it too.
- The source is reached with the caret: arrowing into the link from prose shows its bytes for
  editing, and the link comes back when focus leaves.
- A plain click on a Markdown link follows it too, and opens no link card.
- The Markdown link shows the pointer cursor, since a plain click follows it; in source mode it
  shows the text cursor again.
- In source mode a link shows its syntax, so a plain click there edits it: the widget shows its
  source and the Markdown link opens nothing.
- A drag that starts on the link selects and activates nothing.

Miss-analysis: the harness widget acted on every click by hand instead of asking the editor, so a
widget that read the shared Ctrl/Cmd check (as limestone's did) and did nothing on a plain click
passed every test here.

Miss-analysis (the pointer cursor): the link cursor decided "a plain click follows here" in CSS off
the reading mode alone, a second copy of the rule that no test held against a host that opts in.
