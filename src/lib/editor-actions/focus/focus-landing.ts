/**
 * The last step of a cross-block focus move, shared by both focus dispatchers. A null sticky
 * column is handled here, so `focusAtColumn` always receives a finite x.
 */

import {
	CURSOR_END,
	CURSOR_START,
	type BlockComponent,
	type FocusPosition,
	type StickyColumnDirection
} from '../../block-component';
import type { StickyColumnState } from '../../cursor/sticky-column';

export async function consumeStickyLanding(
	block: BlockComponent,
	index: number,
	position: FocusPosition,
	stickyColumn: StickyColumnState,
	retryAt: (index: number) => Promise<void> | void
): Promise<void> {
	const isStickyMove = typeof position === 'object' && 'stickyColumnFrom' in position;

	if (isStickyMove) {
		const from = position.stickyColumnFrom;
		const arrival = verticalArrival(block, from);
		if (arrival === 'entered') return;
		if (arrival === 'transparent') {
			await retryAt(index + (from === 'below' ? -1 : 1));
			return;
		}
	}

	// Enter an edge widget rather than putting a caret that does nothing at its boundary, so
	// the arrow key produces one visible step.
	if (position === 'start' && block.enterEdgeWidget?.('start')) return;
	if (position === 'end' && block.enterEdgeWidget?.('end')) return;

	if (isStickyMove) {
		const x = stickyColumn.get();
		const from = position.stickyColumnFrom;
		if (x !== null && block.focusAtColumn) {
			block.focusAtColumn(x, from);
			return;
		}
		block.focus(from === 'above' ? CURSOR_START : CURSOR_END);
		return;
	}

	// 'start' and 'end' are arrivals, and the block's focus clamps them to an offset the caret
	// can sit at; a number is a caller that knows its byte (a split's second half), passed through.
	if (typeof position === 'number') block.focus(position);
	else if (position === 'start') block.focus(CURSOR_START);
	else block.focus(CURSOR_END);
}

/** What a vertical arrival does at a block: enter its widget, pass over it, or place a caret. */
export type VerticalArrival = 'entered' | 'transparent' | 'seat';

/**
 * Whether a vertical move stops at a block, shared by the per-block arrival and a container's
 * column entry. A widget-only block has no column, so the move passes over it unless its edge
 * widget takes the arrival, which is a stop of its own from either side. `'entered'` means the
 * widget already took it, so the caller stops rather than entering it again.
 */
export function verticalArrival(
	block: BlockComponent,
	from: StickyColumnDirection
): VerticalArrival {
	if (!block.isVerticallyTransparent?.()) return 'seat';
	return block.enterEdgeWidget?.(from === 'above' ? 'start' : 'end') ? 'entered' : 'transparent';
}
