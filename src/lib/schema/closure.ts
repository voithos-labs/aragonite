/**
 * The tier × subsystem closure matrix, as a type. Every block-kind registration
 * carries a `ClosureBlock` answering each cross-cutting editor system for that
 * kind — the matrix row made a required field, so a blank cell is a compile
 * error instead of the unasked question that shipped the whole-block-focus closure
 * holes (see `docs/design/plugin-contract.md` § "The tier × subsystem closure
 * matrix").
 *
 * Dependency-free leaf: `core/directive/kinds.ts` imports it, so it must not
 * import back toward core.
 *
 * Honesty rule (enforced by review, coherence-checked by G1.24): `implemented`
 * names a real mechanism the kind carries; where none exists the cell is
 * `inherit-default` (the generic editor ceremony, nothing kind-specific) or
 * `not-supported` (the subsystem is structurally absent, with the degradation
 * named). Do not claim a capability to fill a cell.
 */

/** The nine cross-cutting systems a caret-bearing kind meets — one per matrix column. */
export type ClosureColumn =
	| 'roundTrip'
	| 'focus'
	| 'mergeBackspace'
	| 'selectionPaint'
	| 'searchPaint'
	| 'reorder'
	| 'undo'
	| 'clipboard'
	| 'simOracle';

export type ClosureCell =
	| { mode: 'implemented'; via: string }
	| { mode: 'inherit-default' }
	| { mode: 'not-supported'; reason: string };

/** `Record<ClosureColumn, …>` — a missing column is a compile error. */
export type ClosureBlock = Record<ClosureColumn, ClosureCell>;

// ── Simple-leaf preset ──────────────────────────────────────────────────────

/**
 * The five columns a not-mergeable, childless, source-editable leaf built on
 * `createEditableLeaf` answers the same way every such leaf does — structurally
 * fixed, so re-typing them teaches an author nothing (the audit's "meaningless to
 * an author" ceremony). `reorder`/`selectionPaint`/`clipboard` name the platform
 * floor a `createEditableLeaf` leaf inherits (whole-block drag, `measurePartialRects`,
 * byte-slice copy); `mergeBackspace` is fixed by `not-mergeable`; `roundTrip`
 * inherits the default `leadingTrivia + raw` serialize.
 *
 * NOT for containers (a `rebuildRaw` is the round-trip mechanism, so G1.24 forces
 * `roundTrip: implemented`) nor whole-block-focus opaque leaves (they paint a cover
 * rect, not partial rects); those hand-write the full nine.
 */
const SIMPLE_LEAF_BAKED: Pick<
	ClosureBlock,
	'roundTrip' | 'mergeBackspace' | 'selectionPaint' | 'reorder' | 'clipboard'
> = {
	roundTrip: { mode: 'inherit-default' },
	mergeBackspace: {
		mode: 'implemented',
		via: 'not-mergeable — Backspace at the edge moves focus, never concatenates'
	},
	selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
	reorder: { mode: 'implemented', via: 'whole-block drag reorder through the parent BlockList' },
	clipboard: { mode: 'inherit-default' }
};

/**
 * `focus`, `searchPaint`, `undo`, and `simOracle` genuinely vary with the leaf's
 * own component — its edit surface, whether its rendered view carries measurable
 * text, its commit model, its test — so `simpleLeafClosure` requires them; omitting
 * one is a compile error, keeping the matrix's force-an-answer discipline exactly
 * where the answer is the author's. The five baked columns stay optionally
 * overridable for the atypical simple leaf (e.g. a render-primary reveal that
 * scopes its `selectionPaint` to the revealed state).
 */
export type SimpleLeafClosureCells = Pick<
	ClosureBlock,
	'focus' | 'searchPaint' | 'undo' | 'simOracle'
> &
	Partial<
		Pick<ClosureBlock, 'roundTrip' | 'mergeBackspace' | 'selectionPaint' | 'reorder' | 'clipboard'>
	>;

/** Sugar over the same required `closure` field: bakes the five structurally-fixed leaf columns, demands the four the author's component determines. */
export function simpleLeafClosure(cells: SimpleLeafClosureCells): ClosureBlock {
	return { ...SIMPLE_LEAF_BAKED, ...cells };
}
