# Feature: live-mode typing, which side of a hidden delimiter typed bytes land

Live mode paints no construct marker, so one screen position names two raw offsets: before
the closing `**` and after it. Typing is native, and Chromium moves a collapsed caret back
upstream across an unrendered run, so the DOM caret can't express "after the run". So the
browser puts the byte in, and the write that reads it back moves it to its side, the same write
for every way text arrives. An IME commit can't be stopped at all (`insertCompositionText`
isn't cancelable), so its composed run gets moved on the commit `compositionend` drives: the
same side, one commit, one undo entry.

The side is the edge rule's: the letter takes the format of the character before the caret (at a
line start, the one after), unless a record says otherwise (a typed closer, a fresh start). A
link never extends at either edge. Driven on `/test/editor` via `?presentationMode=live` with real
keystrokes, real clicks and a real CDP composition; every scenario checks the source, since the
byte position is the whole contract.

## Happy paths

- typing at bold's trailing content edge extends the construct: the byte lands before the
  closing `**`, and a second byte keeps extending it
- the same position reached leftward across the hidden run, from the text after it, types inside
  too: the character before the caret is bold, whichever way the caret came
- a caret stepped left to bold's leading edge types before it, plain: the character before the
  caret is the space
- a caret that stepped right up to bold's leading edge types before it, plain
- a click at bold's trailing content edge extends the construct

- a childless construct is all delimiters, and this rule reaches it: a line-leading escape or
  an angle autolink has no content range to split on, so a byte typed at the lowest offset the
  caret can reach inside one used to land between delimiters the user never saw (`\Z*Lead`,
  `< https://…>`). The whole node is one run there, and the byte lands outside it
- the angle autolink obeys the same never-extend rule as the bracket form: `End` after a trailing
  one types past the closing bracket rather than rewriting the destination
- the bold control types inside by the same `Home` gesture, from the character after the caret,
  which is what shows the childless class moved and nothing else

- the other pairs behave the same way, on runs bold's cases never exercise: a strikethrough's
  two-byte `~~` and a code span's single backtick both extend from their inside end

## Edge cases

- `Home` on a line that opens with a construct types inside it: at a line start the character
  after the caret decides
- a link's trailing content edge never extends, whichever way the caret came: an arrow from
  inside and an arrow back from the text after it both put the byte after the closing `)`
- a link's leading content edge never extends either: the byte lands before the `[`
- an escape's two bytes are never typed into: a byte typed at either side of `\*` lands
  outside the pair, and the escape survives verbatim
- a hard break's trailing-space run is never typed into: a byte typed at the end of the
  first visual line lands before the two spaces, which survive verbatim

## IME commits

- a composition committed at a link's trailing content edge lands past the closing `)`,
  never inside the link text: never-extend binds keystrokes and IME commits alike
- a composition committed at bold's inside end extends the construct
- after a typed closer, a composition commits past the closing `**`, since the commit reads the
  same record a keystroke does

## Over a selection across blocks

The range runs from a construct's end, the anchor put there by End or by a click (on either side
of a hidden run: the bytes are the same), to the start of the next block, by Shift+Down or a
Shift+click. Each row also removes the same range with
Delete and types the key at the caret, and the key over the range writes those bytes.

- from a link's end: the key lands after the link, `a [link](u)Qapple`, and the next letter
  follows it
- from a bold's end: the key joins the bold, `a **boldQ**cherry`
- from an autolink's end: the key writes what Delete and then the key write
- a one-line paste over each of those selections writes what the key writes
- an IME composition over each of those selections commits where the key's letter landed
- in source mode the key lands where the selection started, every byte shown: `a [linkQapple`

Miss-analysis: every scenario typed at a caret and the range rows started in plain text, so the
range's one answer, which wrote the key at the raw offset with no block's edge rule, went unseen.

## User interactions

- Real keyboard, real clicks and a real CDP composition only: the side is decided in the write
  every insertion goes through, from the record the keys left in the caret memory. A
  programmatic caret write would skip the keys, and would be normalized away anyway
- The caret gets where it is by stepping with arrows, by clicking, or by typing, never by
  setting the caret memory, which is editor-internal

## Held next door

- The same never-extend rule inside a table cell (`[text][ref]`, `End`, one keystroke) is a
  row of `presentation-live-affinity.md`, where that fixture already lives.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture)

Miss-analysis (real Firefox): these scenarios ran on Chromium alone, which never leaves a caret on
a hidden run's far side, where Firefox's ArrowLeft and a click beside the run do.
