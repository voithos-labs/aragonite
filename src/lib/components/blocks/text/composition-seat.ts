/**
 * The selection an IME composition opened over, captured as it opens: it is gone by the time the
 * composed run arrives, and the run replaces it as a typed key over that selection would. A run
 * composed at a plain caret goes to the block's write, which places it and spends the caret
 * memory's records like any insertion.
 */

import type { NodeView } from '../../../core/node-views';
import { trimTrailingLineEnding } from '../../../core/lines';
import type { StoredAs } from '../../../schema/stored-as';
import { drawnRangeWrite } from '../editable/surface-write';

export interface CompositionSeatDeps {
	getNode: () => NodeView;
	/** The block's selection, read as the composition opens. */
	getRawSelection: () => { start: number; end: number } | null;
	storedAs: () => StoredAs;
}

export interface CompositionSeat {
	/** Capture the selection the composition opened over. Call it as the composition opens. */
	noteStart(): void;
	/** The run `compositionend` committed, for a reading the browser's own edit left unreadable. */
	noteCommit(data: string): void;
	/** The bytes the commit should write, or null to write the DOM read as an insertion. */
	relocate(after: string): { raw: string; caret: number } | null;
	noteEnd(): void;
}

interface CompositionWindow {
	before: string;
	range: { start: number; end: number } | null;
	committed?: string;
}

export function createCompositionSeat(deps: CompositionSeatDeps): CompositionSeat {
	// One nullable capture rather than a stack: a composition runs from its opening to the single
	// commit `compositionend` drives.
	let started: CompositionWindow | null = null;

	return {
		noteStart: () => {
			const before = trimTrailingLineEnding(deps.getNode().raw);
			started = { before, range: deps.getRawSelection() };
		},
		noteCommit: (data) => {
			if (started) started.committed = data;
		},
		relocate: (after) => {
			// A selection open at the start makes this a range replace, which the browser would do
			// literally, stranding the delimiter runs the range crossed.
			if (!started?.range || started.range.start >= started.range.end) return null;
			// The browser's edit can take a hidden `[` or `# ` past the range as well, leaving a read that
			// doesn't split around it; the run the composition committed replaces the range then.
			const typed =
				replacedRangeInsertion(started.before, after, started.range) ?? started.committed;
			if (typed === undefined) return null;
			const node = deps.getNode();
			const edit = drawnRangeWrite(node, started.range, typed, deps.storedAs());
			return { raw: edit.text, caret: edit.caretAfter };
		},
		noteEnd: () => {
			started = null;
		}
	};
}

/** The run the commit's reading put over `range`, or undefined when that reading is not a
 *  replacement of exactly that span. */
function replacedRangeInsertion(
	before: string,
	after: string,
	range: { start: number; end: number }
): string | undefined {
	const length = after.length - before.length + (range.end - range.start);
	if (length < 0 || range.end > before.length) return undefined;
	if (after.slice(0, range.start) !== before.slice(0, range.start)) return undefined;
	if (after.slice(range.start + length) !== before.slice(range.end)) return undefined;
	return after.slice(range.start, range.start + length);
}
