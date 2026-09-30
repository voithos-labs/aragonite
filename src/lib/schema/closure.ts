/**
 * The closure matrix as a type: what each block kind does about each cross-cutting system, so a
 * blank cell is a compile error
 * (`docs/design/plugin-contract.md` § Editable content and the closure matrix). An `implemented`
 * cell must name a real mechanism (G1.24). This file imports nothing: `core/directive/kinds.ts`
 * imports it.
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

/** Every column once, so a loop over the matrix misses none: a new column fails to compile here
 *  until it's listed. */
export const CLOSURE_COLUMNS: Record<ClosureColumn, true> = {
	roundTrip: true,
	focus: true,
	mergeBackspace: true,
	selectionPaint: true,
	searchPaint: true,
	reorder: true,
	undo: true,
	clipboard: true,
	simOracle: true
};

export type ClosureCell =
	| { mode: 'implemented'; via: string }
	| { mode: 'inherit-default' }
	| { mode: 'not-supported'; reason: string };

/** `Record<ClosureColumn, …>`: a missing column is a compile error. */
export type ClosureBlock = Record<ClosureColumn, ClosureCell>;

// ── Simple-leaf preset ──────────────────────────────────────────────────────

/**
 * The five columns every not-mergeable, childless, source-editable leaf answers alike. A container
 * (its `roundTrip` must be `implemented`, G1.24) or a whole-block leaf writes every column itself.
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

/** Fills in the five fixed leaf columns and requires the four the author's component decides. */
export function simpleLeafClosure(cells: SimpleLeafClosureCells): ClosureBlock {
	return { ...SIMPLE_LEAF_BAKED, ...cells };
}

// ── Strip-container preset ────────────────────────────────────────────────────

/**
 * The four columns every strip container answers alike: its children paint selection and search,
 * it reorders whole through the parent BlockList, and it holds no clipboard position of its own.
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
 * A container's `rebuildRaw` is its round-trip mechanism, so the preset fixes `roundTrip` to
 * `implemented` and asks only for its `via` (G1.24). The cells that vary with the container are
 * required; the four structural columns stay overridable.
 */
export type ContainerClosureCells = { roundTripVia: string } & Pick<
	ClosureBlock,
	'focus' | 'mergeBackspace' | 'undo' | 'simOracle'
> &
	Partial<Pick<ClosureBlock, 'selectionPaint' | 'searchPaint' | 'reorder' | 'clipboard'>>;

/** Fills in the structural columns and `roundTrip: implemented`; requires the container's cells. */
export function containerClosure(cells: ContainerClosureCells): ClosureBlock {
	const { roundTripVia, ...rest } = cells;
	return {
		...STRIP_CONTAINER_BAKED,
		roundTrip: { mode: 'implemented', via: roundTripVia },
		...rest
	};
}
