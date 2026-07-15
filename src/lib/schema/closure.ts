/**
 * The tier × subsystem closure matrix, as a type. Every block-kind registration
 * carries a `ClosureBlock` answering each cross-cutting editor system for that
 * kind — the matrix row made a required field, so a blank cell is a compile
 * error instead of the unasked question that shipped the 0.9.18 whole-block-focus
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
