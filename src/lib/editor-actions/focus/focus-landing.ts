/**
 * Shared cross-block landing tail for the focus dispatchers: skip vertically-
 * transparent blocks on sticky moves, prefer edge-widget select over a no-op
 * caret at a widget edge, consume captured sticky X (null-handling lives here
 * — focusAtColumn receivers always get a finite x), else land at the
 * requested offset/extremum.
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

	// Vertical-only skip: widget-only blocks contribute no column landing, so
	// ArrowUp/Down passes through in the same direction. Horizontal moves
	// still stop at the widget edge / select it.
	if (isStickyMove && block.isVerticallyTransparent?.()) {
		const direction = position.stickyColumnFrom === 'below' ? -1 : 1;
		await retryAt(index + direction);
		return;
	}

	// Enter an edge widget rather than dropping a no-op caret at its boundary —
	// reveal-capable widgets open their source, images select (one visible step).
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
