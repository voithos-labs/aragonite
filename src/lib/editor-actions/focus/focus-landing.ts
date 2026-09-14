/**
 * Shared cross-block landing tail for the focus dispatchers. Sticky-X null handling
 * lives here, so `focusAtColumn` receivers always get a finite x.
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

	// Enter an edge widget rather than dropping a no-op caret at its boundary, so the
	// arrow key produces one visible step.
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

	// An ARRIVAL says "the start"/"the end" and the door seats it on a landable offset; a numeric
	// position is a caller who knows its byte (a split's continuation) and is passed through.
	if (typeof position === 'number') block.focus(position);
	else if (position === 'start') block.focus(CURSOR_START);
	else block.focus(CURSOR_END);
}

/** What a vertical arrival does at a block: enter its widget, pass over it, or seat a caret. */
export type VerticalArrival = 'entered' | 'transparent' | 'seat';

/**
 * The vertical stop rule, asked by both vertical doors: the per-block landing and a container's
 * column entry. A widget-only block carries no column, so it is passed over unless its edge widget
 * takes the arrival, which is a stop of its own and reads alike from either side. `'entered'` means
 * the widget ALREADY took it, so the caller stops rather than repeating the entry.
 */
export function verticalArrival(
	block: BlockComponent,
	from: StickyColumnDirection
): VerticalArrival {
	if (!block.isVerticallyTransparent?.()) return 'seat';
	return block.enterEdgeWidget?.(from === 'above' ? 'start' : 'end') ? 'entered' : 'transparent';
}
