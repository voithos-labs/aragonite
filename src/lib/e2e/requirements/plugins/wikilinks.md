# Feature: wikilinks that follow on a plain click

`[[note]]` written in prose renders as a link carrying the note's name. The harness plugin
(`routes/test/plugins/wikilinks`) reproduces limestone's integration: a `[[` recognizer at
prefix-override priority, and a widget registered with `revealSource`, `claimsActivationClick`
and `plainClickActivates`. The widget decides whether to act by asking its `isActivationClick`
prop, so these tests go through the same answer the editor uses. Seed `wikilinks`: a link
mid-prose in block 0 and a plain place to type in block 1.

## User interactions

- A plain click on a link is the activation gesture, as on a web page: the widget records it (a
  host opens the note), the link stays mounted and the source does not change.
- Ctrl/Cmd-click activates it too.
- The source is reached with the caret: arrowing into the link from prose shows its bytes for
  editing, and the link comes back when focus leaves.
- A drag that starts on the link selects and activates nothing.

Miss-analysis: the harness widget acted on every click by hand instead of asking the editor, so a
widget that read the shared Ctrl/Cmd check (as limestone's did) and did nothing on a plain click
passed every test here.
