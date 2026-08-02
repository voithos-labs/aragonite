# Feature: Content a code block's fence cannot hold

`fence-ranged-edit.md` settles WHERE an edit may land. This settles what the block's
content regions may HOLD once it has landed — the two characters that used to break a
fence from inside a region the contract calls editable, each verified against the
parser (the `# Heading` below every fixture is the block a broken fence swallows):

```
a fence run on a body line   → fencedCode | paragraph | fencedCode   ← the last swallows the heading
a backtick in the info string → paragraph | fencedCode               ← demoted; its closer opens an absorbing fence
```

The two sources, written out (with the escapes, so the fence runs stay readable):
`"```js\n```\nconst x = 1\n```"` and ``"```j`s\nconst x = 1\n```"``.

A third rule answers the other direction, which no content region can produce: bytes a
sink TRUNCATED past one of the block's own fence lines, leaving an opener nothing ends or
a closer nothing opened. Same swallowed heading, no character to blame.

One write seam answers for every route that commits bytes — typing, IME composition end,
paste, and the sinks that reach a node's raw with no surface in front of them — so no
route can leave bytes the grammar cannot hold. It runs after the edit lands, which is
what separates it from the guard: the guard refuses a write aimed at structure; this
reconciles a legal write against the grammar, and rewrites the fence lines itself when
it must.

## The three rules

- **The fence lines are reconciled, in whichever direction the write broke them.** An
  unclosed fence absorbs every block below it at the next parse, and a truncation can mint
  one from either half, so the surviving first line decides which repair applies. With the
  block's own opener still there, a missing closer is restored — on the block's own run
  length, indent and line ending (the BLOCK's ending, since the written slice may carry
  none), because the metadata still claims a closed fence and the session's structure is
  what the bytes are made legal for. Without that opener, a surviving line reading as this
  fence's closer is machinery the write STRANDED: no metadata claims a block to size a
  fence to, and as text the run would open one over the live siblings below, so it is
  dropped and the body fragment merges as prose. The drop declines when an opener above
  could close on the run — same marker, no longer than it — since that run is then a live
  block's terminator; a foreign-marker or longer-run open line is body text the run never
  terminated.
  On a truncation the restore and the escalation cannot both fire: escalation triggers on a
  body line that reads as this block's closer, which is the line the restore probe reads AS
  the closer, and a truncation only removes bytes.
- **A fence run escalates the fence.** A body line the parser would read as this
  block's closer grows BOTH runs past it, so the line stays content. This is what
  paste has always done with a pasted run, and it is the same shape as a directive's
  colon escalation (`escalatedColonCount`): the system widens its own delimiter so
  the body it must hold stays inside it. The rule reads the LINES a write leaves
  behind, not the characters it carried, so a run landing mid-line changes nothing
  and a run formed at a splice seam is caught.
- **A backtick in a backtick fence's info string is dropped.** GFM forbids it at any
  fence length (CommonMark §4.5), so no escalation can rescue it: typing one is
  inert, and a paste carrying one lands without it. Dropping rather than declining
  the whole paste keeps one rule for both gestures — the character is inert in that
  region however it arrives — and a declined paste would be a silent no-op the user
  cannot distinguish from a broken clipboard. The fence markers are NOT converted to
  tildes to make the character representable: rewriting a marker the author chose is
  a bigger surprise than dropping a character the grammar never had room for.

## The tilde twin

- A tilde run typed or pasted onto a tilde fence's body line escalates exactly as a
  backtick run does — the rule is marker-generic and reads the block's own marker.
- A tilde fence's info string may hold backticks (CommonMark forbids them only in a
  backtick fence's), so nothing is dropped there. That is also the escape hatch for
  an author who needs a backtick in an info string: use a tilde fence.
- A backtick run on a tilde fence's body line is not that block's terminator and
  escalates nothing.

## An open fence is left alone

All three rules are scoped to a CLOSED fence, where a mismatch between the runs is what
makes the block absorb the document. An unclosed fence's marker run is editable
content, typing a closer there is the authoring gesture that ends the block, and
there is no closer to disagree with, nor one to restore. A LITERAL write is the
exception the paste contract already made: pasted bytes are content, so an open fence
grows its opener rather than letting a pasted run terminate the block.

## One door, not a rule per gesture

The reconciliation runs inside the block's single display-commit funnel
(`commitDisplay`, pinned by G4.24) and, for routes that never cross the component
(find-and-replace, cross-block joins, the range-delete truncations), at the byte sinks
via the kind's `normalizeRawWrite`: in place through `writeOwnRaw`, or ahead of a
sink's own reparse through `normalizeOwnRaw`, both pinned by G4.28. Never per gesture.
That matters because a gesture can put an existing body run into terminator position without
adding a character: Enter splitting a line around a mid-line run, or Shift+Tab
dedenting a four-space-indented run to column 0. Both were reachable while the rule
sat at two of the block's ten commit sites, and both reproduce the same corruption.

## Known limits

- **The reconciliation is silent.** A consumer sees the reconciled bytes (the CST is
  the source of truth, and the edit event carries the commit), but nothing announces
  that they differ from what was typed or pasted — an embedding app cannot surface
  "we dropped a character your fence could not hold". An event for it is a
  freeze-surface decision, not this rule's to make.
- **Bare `.raw =` writes escape every door.** `fencedCode` declares
  `normalizeRawWrite`, so every sink that consults the hook reconciles — but a write
  that assigns raw directly does not, and the G4.28 scan cannot see one. The bare writes
  that remain (the chrome-clear and cell-clear arms of the delete branches) reach kinds
  whose slots a `fencedCode` cannot occupy, so none of them can drop a closer today.
- **A bare fence's lone surviving line is read as the closer.** ` ``` ` with no info
  string reads as this block's opener and as its closer alike, so a write leaving only that
  line is ambiguous: a head-side truncation meant to keep an empty code block, a tail-side
  one to strand residue. It is dropped, since the run is unclaimed either way and restoring
  would mint a block from residue — so an emptied bare fence disappears rather than
  surviving empty. A fence with an info string, or a stranded run longer than the block's
  own, is unambiguous and takes its own arm.
- **The in-place sinks keep a kind their bytes no longer describe.** The range-delete
  same-block arm writes raw with no reparse behind it and nothing re-derives the kind
  afterwards, so a drop that turns a code block into prose leaves the node claiming
  `fencedCode`. Kind-generic and not the fence rule's (a heading losing its `#` on the same
  arm does it too); the bytes are correct, so nothing is absorbed on reload.

## Happy paths

- a fence run typed on a body line grows both fence runs; the block stays one code
  block and the heading below it stays its own block
- Enter splitting a body line around a mid-line run grows the fence rather than
  splitting the block
- Shift+Tab dedenting a four-space-indented run to column 0 does the same
- closing a fence by typing its own closer still works: ` ``` `, Enter, code, Enter,
  ` ``` ` yields one closed block (the escalation is scoped to a closed fence
  precisely so this authoring gesture survives)
- a fence run pasted on a body line does the same (the rule moved to the shared seam,
  so paste keeps the behavior it always had)
- a tilde run typed on a tilde fence's body line grows that fence
- a selection running from inside a code body past its closer, deleted, leaves one closed
  code block with the blocks below it still siblings — through every range-delete arm
  (same-block, cross-block merge, the chrome wall, a table endpoint)
- a selection running from an earlier block into a code body, deleted, leaves the surviving
  body fragment as prose and the blocks below it still siblings — through the same four arms,
  including a code block nested in a blockquote

## Edge cases

- a backtick typed into a backtick fence's info string is inert — the source does not
  change
- a paste carrying backticks into the info string lands with them removed
- a backtick typed into a TILDE fence's info string survives untouched
- an IME composition that ends with either shape is reconciled at the same commit, not
  left in the DOM (pinned at the component level, `code-fence-write-commit.test.ts`)
- a restored closer carries the block's own run length, opener indent and line ending —
  a four-backtick block gets four back, a CRLF block a CRLF, including when the document's
  last block has no trailing newline and the slice carries no ending at all; a drop rejoins
  the surviving lines on that same ending rather than stranding half a separator
- a delete that consumes the opener drops the survivor's fence run, whether that is a lone
  closer line or one LONGER than the opener the delete took (legal GFM, and what loaded
  markdown supplies): the fence is gone, not broken
- a delete that consumes BOTH fence lines reconciles nothing — no run survives to drop and
  no metadata survives to restore from
- a find/replace whose match runs from the body through the closer line gets the closer
  back, and one that runs from the opener line down drops the closer it strands, so either
  way the block below it stays a sibling
- a replacement that pushes text ABOVE a surviving opener keeps the closer that opener
  claims, rather than unclosing a live block
- the collapsed caret keeps the offset the truncation gave it — the closer lands after it,
  and a restore never escalates, so no run grows under the caret

## Miss-analysis

- The restore rule shipped watching only the shape a START-side truncation makes (opener
  kept, closer taken), because every pin drove a range that BEGAN in a code body — so its
  decline on a stranded closer read as a deliberate limit rather than as half a rule; and
  an end-side pin would have reached no fence rule at all, since the generic merge
  normalized the joined raw against the START block's rule alone (issue #58).

- The typed-closer case kept a pre-materialization byte expectation (a lone blank line was
  document prefix, so it rode along above the typed block) for the whole 0.9.36 stream: the
  sweep that followed blank lines into blocks picked its e2e projects by the files it
  touched, and this one names no blank line in its fixture. The byte claim now has a tree
  pin (`typed-blank-lines-reload.test.ts`), which runs in every unit pass.
