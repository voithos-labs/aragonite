/**
 * Shared cross-block landing tail for the focus dispatchers. Sticky-X null handling
 * lives here, so `focusAtColumn` receivers always get a finite x.
 */

import {
	CURSOR_END,
	CURSOR_START,
	type BlockComponent,
	type FocusPosition
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

	// Widget-only blocks contribute no column landing, so ArrowUp/Down passes through.
	// Horizontal moves still stop at the widget edge.
	if (isStickyMove && block.isVerticallyTransparent?.()) {
		const direction = position.stickyColumnFrom === 'below' ? -1 : 1;
		await retryAt(index + direction);
		return;
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
