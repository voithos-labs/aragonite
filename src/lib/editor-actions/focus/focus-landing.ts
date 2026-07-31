/**
 * Shared cross-block landing tail for the focus dispatchers. Sticky-X null handling
 * lives here, so `focusAtColumn` receivers always get a finite x.
 */

import { CURSOR_END, type BlockComponent, type FocusPosition } from '../../block-component';
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
		block.focus(from === 'above' ? 0 : CURSOR_END);
		return;
	}

	if (typeof position === 'number') block.focus(position);
	else if (position === 'start') block.focus(0);
	else block.focus(CURSOR_END);
}
