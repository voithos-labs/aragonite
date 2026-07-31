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

One write seam answers for every route that commits content — typing, IME composition
end, and paste — so no gesture can carry content the grammar cannot hold. It runs
after the edit lands, which is what separates it from the guard: the guard refuses a
write aimed at structure; this reconciles a legal write against the grammar, and
rewrites the fence lines itself when it must.

## The two rules

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

Both rules are scoped to a CLOSED fence, where a mismatch between the runs is what
makes the block absorb the document. An unclosed fence's marker run is editable
content, typing a closer there is the authoring gesture that ends the block, and
there is no closer to disagree with. A LITERAL write is the exception the paste
contract already made: pasted bytes are content, so an open fence grows its opener
rather than letting a pasted run terminate the block.

## One door, not a rule per gesture

The reconciliation runs inside the block's single display-commit funnel
(`commitDisplay`, pinned by G4.24), not at the gestures that write. That matters
because a gesture can put an existing body run into terminator position without
adding a character: Enter splitting a line around a mid-line run, or Shift+Tab
dedenting a four-space-indented run to column 0. Both were reachable while the rule
sat at two of the block's ten commit sites, and both reproduce the same corruption.

## Known limits

- **The reconciliation is silent.** A consumer sees the reconciled bytes (the CST is
  the source of truth, and the edit event carries the commit), but nothing announces
  that they differ from what was typed or pasted — an embedding app cannot surface
  "we dropped a character your fence could not hold". An event for it is a
  freeze-surface decision, not this rule's to make.
- **Write routes outside this surface do not cross the funnel.** Find-and-replace
  writes a leaf's raw through the kind descriptor's `normalizeRawWrite`, which
  `fencedCode` does not declare, so a replacement that lands a closer run on a body
  line still splits the block. Tracked as issue #45.

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

## Edge cases

- a backtick typed into a backtick fence's info string is inert — the source does not
  change
- a paste carrying backticks into the info string lands with them removed
- a backtick typed into a TILDE fence's info string survives untouched
- an IME composition that ends with either shape is reconciled at the same commit, not
  left in the DOM (pinned at the component level, `code-fence-write-commit.test.ts`)
