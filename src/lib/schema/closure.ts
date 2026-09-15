/**
 * The closure matrix as a type: for each block kind, what it does about each cross-cutting
 * system. Every block-kind registration carries a `ClosureBlock`, so a blank cell is a compile
 * error (`docs/design/plugin-contract.md` § "Editable content and the closure matrix"). This file
 * imports nothing: `core/directive/kinds.ts` imports it, so it must not import back into core.
 * `implemented` must name a real mechanism; never claim a capability to fill a cell (G1.24).
 */

/** The cross-cutting systems a kind with a caret has to answer for, one per matrix column. */
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

/** `Record<ClosureColumn, …>`: a missing column is a compile error. */
export type ClosureBlock = Record<ClosureColumn, ClosureCell>;

// ── Simple-leaf preset ──────────────────────────────────────────────────────

/**
 * The five columns every not-mergeable, childless, source-editable `createEditableLeaf` leaf
 * answers the same way. They follow from that shape, so retyping them teaches an author nothing.
 * Not for containers (G1.24 requires `roundTrip: implemented` on them) and not for whole-block
 * leaves (they paint one covering rectangle, not per-character ones); those write every column.
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
 * `focus`, `searchPaint`, `undo` and `simOracle` really do vary with the leaf's own component, so
 * `simpleLeafClosure` requires them: the matrix forces an answer exactly where the answer is the
 * author's. The five fixed columns can still be overridden.
 */
export type SimpleLeafClosureCells = Pick<
	ClosureBlock,
	'focus' | 'searchPaint' | 'undo' | 'simOracle'
> &
	Partial<
		Pick<ClosureBlock, 'roundTrip' | 'mergeBackspace' | 'selectionPaint' | 'reorder' | 'clipboard'>
	>;

/** A shorthand for the same required `closure` field: fills in the five fixed leaf columns and requires the four the author's component decides. */
export function simpleLeafClosure(cells: SimpleLeafClosureCells): ClosureBlock {
	return { ...SIMPLE_LEAF_BAKED, ...cells };
}

// ── Strip-container preset ────────────────────────────────────────────────────

/**
 * The four columns every strip container answers the same way: its children do the selection and
 * search painting, it reorders as a whole block through the parent BlockList, and it holds no
 * clipboard position of its own. `reorder` and `clipboard` can still be overridden below.
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
 * `roundTrip` is `implemented` for any container, since its `rebuildRaw` is the mechanism
 * (G1.24), so this preset fixes the mode and asks only for the `via`, which makes an
 * inherit-default cell impossible here. `focus`, `mergeBackspace`, `undo` and `simOracle` vary
 * with the container, so they are required; the four structural columns stay overridable.
 */
export type ContainerClosureCells = { roundTripVia: string } & Pick<
	ClosureBlock,
	'focus' | 'mergeBackspace' | 'undo' | 'simOracle'
> &
	Partial<Pick<ClosureBlock, 'selectionPaint' | 'searchPaint' | 'reorder' | 'clipboard'>>;

/** A shorthand for the same required `closure` field: fills in the four structural strip-container columns and `roundTrip: implemented`, and requires the container-specific cells. */
export function containerClosure(cells: ContainerClosureCells): ClosureBlock {
	const { roundTripVia, ...rest } = cells;
	return {
		...STRIP_CONTAINER_BAKED,
		roundTrip: { mode: 'implemented', via: roundTripVia },
		...rest
	};
}
