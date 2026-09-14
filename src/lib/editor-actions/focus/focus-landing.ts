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

	// Widget-only blocks contribute no column landing, so ArrowUp/Down passes through — unless
	// the block is enterable as an object, which is a stop of its own.
	if (isStickyMove && block.isVerticallyTransparent?.()) {
		const from = position.stickyColumnFrom;
		if (entersAsObject(block, from)) return;
		await retryAt(index + (from === 'below' ? -1 : 1));
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

/**
 * A block vertical travel would pass over is still a STOP where it can be entered as an object:
 * one press selects the widget, the next leaves it, and both directions read it alike. The rule
 * both vertical doors share — the per-block landing and the container's column entry.
 */
export function entersAsObject(block: BlockComponent, from: StickyColumnDirection): boolean {
	return block.enterEdgeWidget?.(from === 'above' ? 'start' : 'end') ?? false;
}
