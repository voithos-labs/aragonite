# Feature: styled inline text that follows a click

An `inline({ class, follow })` construct (`routes/test/plugins/note-refs`, the `#work` tag in the
seed's last paragraph) stays text the caret edits, and runs `follow` on the click the host picked
for links. The harness records each followed tag. Live mode unless a row says otherwise.

Miss-analysis: a new surface; its first check in a browser was a throwaway probe, so no row held
what a click, a double click or a drag does on the tag.

## Happy paths

- The host's link click on the tag (Ctrl or Cmd held): `follow` runs with the tag's data, and the
  paragraph still takes typing.
- Reading mode, a plain click on a tag typed a moment before: `follow` runs with that tag's data.

## User interactions

- A plain click on the tag follows nothing and puts the caret in the tag: a letter typed lands in
  its bytes.
- A double click on the tag follows nothing and selects a word.
- A drag that starts and ends inside the tag follows nothing and selects its letters, in live mode
  and in reading mode.

## Edge cases

- With the tag on the page, axe finds no violation outside the baseline, in live mode or reading.
