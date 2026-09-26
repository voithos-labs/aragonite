# Feature: Content a code block's fence cannot hold

`fence-ranged-edit.md` and `fence-line-editing.md` decide where an edit may land. This file decides what the block's
content regions may hold once it has: the two characters that used to break a fence from
inside a region the contract calls editable, each checked against the parser (the
`# Heading` below every fixture is the block a broken fence swallows):

```
a fence run on a body line   → fencedCode | paragraph | fencedCode   ← the last swallows the heading
a backtick in the info string → paragraph | fencedCode               ← demoted; its closer opens an absorbing fence
```

The two sources, written out (with the escapes, so the fence runs stay readable):
`"```js\n```\nconst x = 1\n```"` and ``"```j`s\nconst x = 1\n```"``.

A third rule answers the other direction, which no content region can produce: bytes cut
short past one of the block's own fence lines by code that writes raw directly, leaving an
opener nothing ends or a closer nothing opened. The same swallowed heading, with no
character to blame.

One place answers for every route that commits bytes: typing, the end of an IME
composition, paste, and the code that reaches a node's raw with no component in front of
it, so no route can leave bytes the grammar cannot hold. It runs after the edit lands,
which is what separates it from the dev-mode check: that check refuses a write aimed at
structure, while this one squares a legal write with the grammar, and rewrites the fence
lines itself when it must.

## The three rules

- **The fence lines are repaired, in whichever direction the write broke them.** An
  unclosed fence absorbs every block below it at the next parse, and a write cut short can
  leave one from either half, so the surviving first line decides which repair applies. With
  the block's own opener still there, a missing closer is restored, on the block's own run
  length, indent and line ending (the block's ending, since the written slice may carry
  none), because the node still says it is a closed fence and the structure on screen is
  what the bytes are made legal for. Without that opener, a surviving line reading as this
  fence's closer is left-over syntax the write stranded: nothing says there is a block to
  size a fence to, and read as text the run would open one over the live siblings below, so
  it is dropped and the body fragment merges as prose. The drop is skipped when an opener
  above could close on the run (same marker, no longer than it), since that run is then a
  live block's terminator; an open line with a different marker or a longer run is body text
  the run never terminated.
  On a write cut short the restore and the growth cannot both fire: the fence grows on a
  body line that reads as this block's closer, which is the very line the restore reads as
  the closer, and cutting a write short only removes bytes.
- **A fence run grows the fence.** A body line the parser would read as this
  block's closer grows both runs past it, so the line stays content. This is what
  paste has always done with a pasted run, and it is the same shape as a directive
  growing its colons (`escalatedColonCount`): the editor widens its own delimiter so
  the body it must hold stays inside it. The rule reads the lines a write leaves
  behind, not the characters it carried, so a run landing mid-line changes nothing
  and a run formed where two pieces were joined is caught.
- **A backtick in a backtick fence's info string is dropped.** GFM forbids it at any
  fence length (CommonMark §4.5), so growing the fence cannot rescue it: typing one
  does nothing, and a paste carrying one lands without it. Dropping it rather than
  refusing the whole paste keeps one rule for both gestures, since the character does
  nothing in that region however it arrives, and a refused paste would do nothing
  visible, which a user cannot tell from a broken clipboard. The fence markers are not
  turned into tildes to make the character legal: rewriting a marker the author chose
  is a bigger surprise than dropping a character the grammar never had room for.

## The tilde form

- A tilde run typed or pasted onto a tilde fence's body line grows the fence exactly as
  a backtick run does: the rule is written for any marker and reads the block's own.
- A tilde fence's info string may hold backticks (CommonMark forbids them only in a
  backtick fence's), so nothing is dropped there. That is also the way out for
  an author who needs a backtick in an info string: use a tilde fence.
- A backtick run on a tilde fence's body line is not that block's terminator and
  grows nothing.

## An open fence is left alone

All three rules apply to a closed fence only, where runs that disagree are what make the
block absorb the document. An unclosed fence's marker run is editable content, typing a
closer there is how a writer ends the block, and there is no closer to disagree with,
nor one to restore. A write that must land literally is the exception the paste contract
already made: pasted bytes are content, so an open fence grows its opener rather than
letting a pasted run end the block.

## One place, not a rule per gesture

The repair runs in the one call every display commit goes through
(`commitDisplay`, pinned by G4.24) and, for routes that never cross the component
(find-and-replace, cross-block joins, the range deletes that cut bytes short), where those
routes write bytes, through the kind's write rule (`rawWrite`): in place through `writeOwnRaw`,
or ahead of that route's own reparse through `normalizeOwnRaw`, both pinned by G4.28. Never
once per gesture. That matters because a gesture can put an existing body run in closer
position without adding a character: Enter splitting a line around a mid-line run, or
Shift+Tab dedenting a four-space-indented run to column 0. Both were reachable while the
rule sat at two of the block's ten commit sites, and both produce the same corruption.

## Known limits

- **The repair is silent.** A consumer sees the repaired bytes (the CST is
  the source of truth, and the edit event carries the commit), but nothing announces
  that they differ from what was typed or pasted, so an embedding app cannot tell a user
  "we dropped a character your fence could not hold". Whether to add an event for it is
  a decision about the public API, not this rule's to make.
- **Bare `.raw =` writes repair nothing, but no longer arrive unseen.** `fencedCode`
  declares a write rule (`rawWrite`), so every writer that consults it repairs the bytes;
  a write that assigns raw directly does not. G4.28 now counts those writes across every
  library source and holds each file to an approved number, so write N+1 is a decision
  rather than a hole. The approved writes are the kinds' own rebuilders, the
  paragraph-guarded merges, and the branches of delete that clear a block's markers or a
  table cell: none reaches a position a `fencedCode` can occupy, so none of them can drop
  a closer today.
- **A bare fence's lone surviving line is read as the closer.** ` ``` ` with no info
  string reads as this block's opener and as its closer alike, so a write leaving only that
  line is ambiguous: a cut from the head meant to keep an empty code block, a cut from the
  tail to leave a remnant behind. It is dropped, since nothing owns the run either way and
  restoring would build a block out of a remnant, so an emptied bare fence disappears rather
  than surviving empty. A fence with an info string, or a stranded run longer than the
  block's own, is unambiguous and takes its own branch.
- **The writes that land in place keep a kind their bytes no longer describe.** The branch
  of range delete that stays inside one block writes raw with no reparse behind it and
  nothing works the kind out again afterwards, so a drop that turns a code block into prose
  leaves the node still calling itself `fencedCode`. That holds for every kind and is not the
  fence rule's doing (a heading losing its `#` on the same branch does it too); the bytes are
  correct, so nothing is absorbed on reload.

## Happy paths

- a fence run typed on a body line grows both fence runs; the block stays one code
  block and the heading below it stays its own block
- Enter splitting a body line around a mid-line run grows the fence rather than
  splitting the block
- Shift+Tab dedenting a four-space-indented run to column 0 does the same
- authoring a fence by typing: ` ``` `, Enter (the bare opener completes to opener, empty body
  line, closer), code, Enter, Enter (the trailing empty line exits) yields one closed block and
  a paragraph below it. A typed fence is closed from its first Enter, so a closer run typed into
  the body afterwards is a body line the fence grows around, never a second closer
- a fence run pasted on a body line does the same (the rule moved to the one shared place,
  so paste keeps the behavior it always had)
- a tilde run typed on a tilde fence's body line grows that fence
- a selection running from inside a code body past its closer, deleted, leaves one closed
  code block with the blocks below it still siblings, through every branch of range delete
  (inside one block, the cross-block merge, the stop at a block's own markers, a table endpoint)
- a selection running from an earlier block into a code body, deleted, leaves the surviving
  body fragment as prose and the blocks below it still siblings, through those same four
  branches, including a code block nested in a blockquote

## Edge cases

- a paste carrying backticks into the info string lands with them removed
- an IME composition that ends with either shape is repaired at the same commit, not
  left in the DOM (pinned at the component level, `code-fence-write-commit.test.ts`)
- a restored closer carries the block's own run length, opener indent and line ending:
  a four-backtick block gets four back, a CRLF block a CRLF, including when the document's
  last block has no trailing newline and the slice carries no ending at all; a drop rejoins
  the surviving lines on that same ending rather than leaving half a separator
- a delete that consumes the opener drops the survivor's fence run, whether that is a lone
  closer line or one longer than the opener the delete took (legal GFM, and what loaded
  markdown supplies): the fence is gone, not broken
- a delete that consumes both fence lines repairs nothing: no run survives to drop and
  nothing survives to restore from
- a find/replace whose match runs from the body through the closer line gets the closer
  back, and one that runs from the opener line down drops the closer it strands, so either
  way the block below it stays a sibling
- a replacement that pushes text above a surviving opener keeps the closer that opener
  owns, rather than leaving a live block unclosed
- the collapsed caret keeps the offset the shortened write gave it: the closer lands after
  it, and a restore never grows a run, so no run grows under the caret

## Miss-analysis

- The restore rule shipped watching only the shape a cut from the start makes (opener
  kept, closer taken), because every test drove a range that began in a code body, so its
  refusal on a stranded closer read as a deliberate limit rather than as half a rule; and
  a test cutting from the other end would have reached no fence rule at all, since the
  shared merge normalized the joined raw against the first block's rule alone (issue #58).

- The typed-closer case kept a byte expectation from before blank lines moved onto the
  blocks (a lone blank line was a prefix on the document, so it stayed above the typed block)
  for the whole 0.9.36 stream: the pass that moved blank lines into blocks picked its e2e
  projects by the files it touched, and this one names no blank line in its fixture. The byte
  claim now has a unit test on the tree (`typed-blank-lines-reload.test.ts`), which runs in
  every unit pass.
