# Pre-freeze re-audit findings — 2026-08-14

Scoped review over the delta since 2026-07 (baseline `ba279a88a`): four bug-pass auditors with disjoint scopes (live seams; commit ceremony + tree-ops; dispatch + doors; a dedicated adversarial lens), each finding probe-verified before recording. Falsified candidates are recorded in the audit reports with their disproofs and are not repeated here. Fix tiers reference this table; every finding routes to exactly one destination.

## The dominant class (named, confirmed three ways)

**A funnel is only as good as its last entry path, and this window's guards count participants, not entries.** The verification funnels built in 2026-08 (the live rewrite oracle, the join seam, the settle funnel, the command admissibility seam) are each sound for the paths that cross them; the findings below are, almost without exception, sibling paths that never arrive: a toggle that never asks the painter, a word-delete that never reaches the join, a delete window the settle never probes, an override tier a pre-gate never consults. The lints guarding these funnels (G4.33's oracle-namer census above all) are one-directional: a module that writes bytes and asks nothing is structurally invisible to them.

## Generalized miss-analysis (why the suites missed all of it)

1. **Gesture vocabularies trail the product surface.** The fuzzer has no format-toggle, word-delete, line-delete, or drag gesture; G2.13's lane has split/delete/commit but not merge. Every gesture family absent from an oracle's vocabulary is a blind funnel entrance.
2. **Structural generators are tame by construction.** Every structural property suite draws pure ASCII; the live lane never draws CRLF; the fuzzer's own offset clamp snaps away the mid-surrogate shape, asserting an invariant no production seam enforces.
3. **Harness views hide the facts the funnels need.** The unit harness's suffix-less parent views make the tail-mint arm dead in every structural fixture; G2.13 drives `deleteNode` with a Document parent production never passes, so the property passes vacuously for the class.
4. **One-directional censuses.** Set-equality over files that NAME a seam cannot see a file that should name it and does not.

## Findings

Severity uses the ledger vocabulary (`important` = byte corruption or contract-breaking; `minor` = real defect, bounded harm). Routes: FIX-1 (tree-ops dispatch), FIX-2 (live-seams dispatch), FIX-3 (dispatch-layer dispatch), FIX-4 (generators/oracles dispatch), ISSUE (ledgered), DOCS, ACCEPT.

### Theme: destructive gestures that never reach their funnel

| ID | Finding | Sev | Route |
| --- | --- | --- | --- |
| R4-A1/A2 | The block join's two sinks: Delete at a heading's end before a multi-line paragraph silently drops a line (`reparseAsNode` truncates); Backspace the other way writes a divergent leaf (`writeMergedLeaf` multi-block arm), no warn, merge absent from G2.13's lane | important | FIX-1 (+#166 rewritten) |
| R2-F1 | The settle funnel never asks the tail question on a delete window: G2.13 break with no warn, then ids/refs desync on the next commit; the suffix answer is carried at 1 of 6 sibling views | important | FIX-1 (+new issue) |
| R1-B | Word-delete/line-delete/drag/spellcheck-replace bypass `cleanJoinedRaw`: two gates fail open (`getRawSelection` null at collapsed carets; a 3-element inputType allowlist); CodeBlock's `getTargetRanges` shape is the fix | important | FIX-2 |
| R1-D | The join seam reads `splitBehavior` but not `autoUnwrapOnEmpty`: a range delete emptying a link leaves `[](url)` invisible in the file | important | FIX-2 (batch with #136) |
| R1-A | A live selection toggle over boundary whitespace writes delimiters that paint (`**hello **world`); `toggleInlineFormat` never verifies; the fix exists at the split sibling (`assembleSpaceOutside`) | important | FIX-2 |

### Theme: the dispatch layer's pre-gates and sets

| ID | Finding | Sev | Route |
| --- | --- | --- | --- |
| R3-F1 | `isEditorGlobalChord` pre-gates never consult the override map: a global rebind is dead at root, gap, and both container-bubble states; `dispatchKindCommand` drops a resolved global id silently | important | FIX-3 |
| R3-F2 | A global chord disable is honored by `reservedChords()` and ignored by every arm: the editor reports release, implements swallow | important | FIX-3 |
| R3-F3 | `link.openCard` (published toolbar id) is outside `SINGLE_BLOCK_RANGE_COMMAND_IDS`; under a backward cross-block range the create card opens over a fabricated range (#127's watch condition fired; explains #157's direction-dependent probe) | important | FIX-3 |
| R3-F4 | The dead-key warn is once-per-id process-global, so a door no-op burns the diagnostic for the chord path | minor | FIX-3 |
| R3-F5 | `withEnterCompletion`'s header over-claims "exactly once" (the blockquote-exit parent hop is a second, always-declining consult) | nit | FIX-3 (wording) |

### Theme: Unicode and adversarial input

| ID | Finding | Sev | Route |
| --- | --- | --- | --- |
| R4-A3 | #105 splits: the rangeDelete arm destroys the surviving surrogate half irrecoverably, reachable via `setSelection` (important); the split arm is session-recoverable (stays minor). Fix: `snapToScalarBoundary` at `normalizeCharEndpoint` + `clampToLandableRaw`, belts at the two cut seams; no Intl.Segmenter | important/minor | FIX-1 (+issue split) |
| R4-A4 | 511x container-raw amplification on a single adversarial line (`MAX_NESTING_DEPTH` bounds nodes, not bytes); quantifies performance.md's acknowledged tail | minor | ISSUE |
| R4-A5 | #121's outcome is duplication below the paste, not survival in place | minor | ISSUE (body amended) |
| R4-A6 | `convertGithubAlerts` is non-idempotent on nested alerts; the dev idempotence probe fires on ordinary content | minor | ISSUE |

### Theme: ceremony hygiene and storage

| ID | Finding | Sev | Route |
| --- | --- | --- | --- |
| R2-F2 | A commit into a never-mounted container publishes wrong-length `childIds`; nothing reconciles | important | FIX-1 |
| R2-F3 | `splitNode` is the one seam-absorb caller not passing `sharing` (guarded by window-shape accident) | watch | FIX-1 (one argument) |
| R2-F4 | `path-mutate`'s doors carry an unstated G1.9 unshare precondition; make `sharing` required | minor | FIX-1 |
| R2-F5 | invariants.md's rollback-residual paragraph overstates the gap post-`savedRaws`; `savedDocSuffix` untested | minor | FIX-1 (docs+test) |
| R2-F6/F7 | `history.ts` hands the entry's own `blockIds` array to live state; same-kind reparse arms skip `assignChildIdsDeep` (falsified as reachable, hardened anyway) | hardening | FIX-1 |
| R1-C | Live-mode § 4.2's fourth construct-relative-seat producer (structural landings) is unimplemented; reachability unconfirmed | minor | ISSUE |

### Theme: L2 litmus + leads routed onward

- **L2 verdict: PASS.** The plugin normalize hook fits between mutate and settle over the owned scope view; state now: the one-contiguous-window contract and the revoked-view requirement (DOCS: plugin-contract.md § Target shapes). Close R2-F1 before opening the seam.
- Routed leads for the selection/paste territory (carried into FIX-1's brief as verification targets): the range-delete same-block arm spends `doc.suffix` out of ceremony; `range-delete-table.ts`'s empty-document filler grows `doc.children` outside the funnel; `container-match.ts` calls the content funnel without `sharing`.
- Severity promotions per the audit's discriminator (a catalogued-contract break is important regardless of reach): #21, #130, #166.
- Clean bills worth recording: url-policy (no bypass under entity/NUL/Unicode-whitespace scheme smuggling), the inline scan's linearity to 256 KB, the ref-slot in-place-publish contract, the rollback registers, decorations' verdict seam.

## Fix-tier order

FIX-1 tree-ops (line loss + tail funnel + ceremony hygiene) → FIX-2 live seams (A/B/D + fuzzer gestures) → FIX-3 dispatch layer → FIX-4 generators/oracles (non-ASCII structural corpus, CRLF in the live lane, the well-formedness oracle replacing the offset clamp — must land together). Full battery + perf after the tiers; each fix red-first with a miss-analysis; gate lists derive from files touched.
