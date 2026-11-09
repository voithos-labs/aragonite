/**
 * The keyboard's way into an interactive mark: the `onActivate` of the mark covering the caret,
 * picked by the same precedence rule the pointer follows. A caret at either edge of a mark
 * counts as inside it; over a range, the focus end is the caret.
 */

import type { IndexedDecoration } from './buckets';
import { winningMark } from './mark-interactions';
import type { MarkDecoration } from './types';

export interface MarkActivationDeps {
	/** The caret, or a range's focus, as a character offset in a block; null when there is none. */
	caret(): { path: number[]; offset: number } | null;
	marksForPath(path: number[]): readonly IndexedDecoration<MarkDecoration>[];
	/** The viewport rects the mark paints, empty while its block is not rendered. */
	paintedRects(dec: MarkDecoration): DOMRect[];
	caretRect(): DOMRect | null;
	runMarkHandler(dec: MarkDecoration, call: () => void): void;
}

/** What `decorations.activateAtCaret` runs against. */
export interface MarkActivation {
	canActivate(): boolean;
	/** Runs the mark's `onActivate`; false when no mark with one covers the caret. */
	activate(): boolean;
}

export function createMarkActivation(deps: MarkActivationDeps): MarkActivation {
	function target(): MarkDecoration | undefined {
		const caret = deps.caret();
		if (!caret) return undefined;
		const covering = (dec: MarkDecoration) =>
			!!dec.interactive?.onActivate && dec.start <= caret.offset && caret.offset <= dec.end;
		return winningMark(deps.marksForPath(caret.path), covering)?.dec;
	}

	return {
		canActivate: () => target() !== undefined,
		activate() {
			const dec = target();
			if (!dec) return false;
			const anchor = anchorOn(deps.paintedRects(dec), deps.caretRect());
			deps.runMarkHandler(dec, () => dec.interactive?.onActivate?.(dec, { anchor }));
			return true;
		}
	};
}

/** The mark's rect on the caret's line; its first rect, or the caret, when none is. */
function anchorOn(rects: DOMRect[], caret: DOMRect | null): DOMRect {
	if (caret) {
		const mid = caret.top + caret.height / 2;
		const onLine = rects.find((r) => r.top <= mid && mid <= r.bottom);
		if (onLine) return onLine;
	}
	return rects[0] ?? caret ?? new DOMRect();
}
