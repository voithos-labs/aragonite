/**
 * The tier × subsystem closure matrix as a type: every block-kind registration carries a
 * `ClosureBlock`, so a blank cell is a compile error (`docs/design/plugin-contract.md` § "Editable
 * content and the closure matrix"). Dependency-free leaf — `core/directive/kinds.ts` imports
 * it, so it must not import back toward core. Honesty rule (coherence-checked by G1.24):
 * `implemented` names a real mechanism; never claim a capability to fill a cell.
 */

/** The cross-cutting systems a caret-bearing kind meets — one per matrix column. */
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
 * The five columns every not-mergeable, childless, source-editable `createEditableLeaf` leaf
 * answers identically — structurally fixed, so re-typing them teaches an author nothing.
 * NOT for containers (G1.24 forces `roundTrip: implemented` on them) nor whole-block-focus
 * opaque leaves (they paint a cover rect, not partial rects); those hand-write every column.
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
 * `focus`, `searchPaint`, `undo`, and `simOracle` genuinely vary with the leaf's own component,
 * so `simpleLeafClosure` requires them — the matrix's force-an-answer discipline kept exactly
 * where the answer is the author's. The five baked columns stay optionally overridable.
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
 * The four columns every strip container answers the same structural way: its children are the
 * paint and search surfaces, it reorders whole-block through the parent BlockList, and it holds
 * no clipboard anchor of its own. `reorder`/`clipboard` stay overridable below.
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
 * `roundTrip` is `implemented` for any container (its `rebuildRaw` IS the mechanism, G1.24), so
 * the preset bakes the mode and demands only its `via`, making the inherit-default violation
 * unrepresentable here. `focus`/`mergeBackspace`/`undo`/`simOracle` vary with the container, so
 * they are required; the four structural columns stay overridable.
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
