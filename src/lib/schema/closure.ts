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

// ── Strip-container preset ────────────────────────────────────────────────────

/**
 * The four columns every strip container (real child blocks under a rebuilt marker
 * wrapper) answers the same structural way: its children are the paint and search
 * surfaces, it reorders whole-block through the parent BlockList, and it holds no
 * clipboard anchor of its own. `reorder`/`clipboard` are the common case — a
 * container that adds an indent gesture or a `containerPaste` route overrides its
 * one cell — so they stay optionally overridable below.
 */
const STRIP_CONTAINER_BAKED: Pick<
	ClosureBlock,
	'selectionPaint' | 'searchPaint' | 'reorder' | 'clipboard'
> = {
	selectionPaint: {
		mode: 'implemented',
		via: 'child blocks paint natively; the container paints a cover rect spanning them'
	},
	searchPaint: {
		mode: 'implemented',
		via: 'search descends into the real child blocks; marks overlay per child'
	},
	reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
	clipboard: { mode: 'inherit-default' }
};

/**
 * `roundTrip` is `implemented` for any container (its `rebuildRaw` IS the round-trip
 * mechanism, G1.24), so the preset bakes the mode and demands only its `via` — the
 * container's roundTrip-inherit-default violation becomes unrepresentable through
 * this seam. `focus`/`mergeBackspace`/`undo`/`simOracle` genuinely vary with the
 * container's walk target, unwrapRole, commit model, and test, so they are required.
 * The four structural columns stay overridable for the container that diverges on one.
 */
export type ContainerClosureCells = { roundTripVia: string } & Pick<
	ClosureBlock,
	'focus' | 'mergeBackspace' | 'undo' | 'simOracle'
> &
	Partial<Pick<ClosureBlock, 'selectionPaint' | 'searchPaint' | 'reorder' | 'clipboard'>>;

/** Sugar over the same required `closure` field: bakes the four structural strip-container columns and `roundTrip: implemented`, demands the container-specific cells. */
export function containerClosure(cells: ContainerClosureCells): ClosureBlock {
	const { roundTripVia, ...rest } = cells;
	return {
		...STRIP_CONTAINER_BAKED,
		roundTrip: { mode: 'implemented', via: roundTripVia },
		...rest
	};
}
