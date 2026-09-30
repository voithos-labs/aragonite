/**
 * Swapping between a rendered view and its editable source: the caret logic shared by inline
 * widgets and blocks that render by default (both inject the swap and the revealed flag).
 * Precondition: `source.length === sourceEnd - sourceStart`, asserted at entry (G1.26).
 */

import { tick } from 'svelte';
import { placeCaretAtRaw } from './widget-offset';
import { assertInvariant } from '../assert';
import { checkRevealSourceLength } from '../invariants/inline-transitions';

export interface SourceRevealDeps {
	/** The block's contenteditable element, where the offset walk runs. Null while the source
	 *  is unmounted (a block that is showing its rendered view). */
	get container(): HTMLElement | null;
	/** Source's raw byte range [start, end) in the block source. */
	get sourceStart(): number;
	get sourceEnd(): number;
	/** The source's raw bytes; `length` must equal `sourceEnd - sourceStart`. */
	get source(): string;
	/** Whether the editable source is currently shown. Owned by the consumer
	 *  (inline: a captured text node; block: a reactive flag). */
	isRevealed(): boolean;
	/** Swap the rendered view for editable source. May decline (leave `isRevealed`
	 *  false), for example when the inline widget is not in the DOM. */
	showSource(): void;
	/** Swap the editable source back for the rendered view (inverse of showSource). */
	showRendered(): void;
}

export interface SourceReveal {
	isRevealed(): boolean;
	/** Swap to editable source; caret at `sourceStart + atSourceOffset` (default edge). */
	reveal(atSourceOffset?: number): Promise<void>;
	/** Swap back to the rendered view; caret at the trailing edge (`sourceEnd`). */
	commit(): Promise<void>;
}

export function createSourceReveal(deps: SourceRevealDeps): SourceReveal {
	// Offset 0 of a source that opens with hidden markers (a block hiding its `$$` fence lines) is
	// before those markers, where typing would land outside the fence, so the write clamps.
	function placeCaret(container: HTMLElement, blockSourceOffset: number): void {
		placeCaretAtRaw(container, blockSourceOffset, { clamp: 'reachable' });
	}

	async function reveal(atSourceOffset = 0): Promise<void> {
		assertInvariant('reveal-transition', () =>
			checkRevealSourceLength(deps.source.length, deps.sourceStart, deps.sourceEnd)
		);
		if (!deps.isRevealed()) deps.showSource();
		if (!deps.isRevealed()) return; // swap declined (the widget is not in the DOM)
		await tick();
		const settled = deps.container;
		if (!settled) return;
		// Focus before the caret write: a caret placed in an unfocused editable receives no
		// typing, and focusing afterwards would reset the selection to the element start.
		if (document.activeElement !== settled) settled.focus();
		const clamped = Math.max(0, Math.min(atSourceOffset, deps.source.length));
		placeCaret(settled, deps.sourceStart + clamped);
	}

	async function commit(): Promise<void> {
		if (!deps.isRevealed()) return;
		deps.showRendered();
		await tick();
		const settled = deps.container;
		if (!settled) return;
		placeCaret(settled, deps.sourceEnd);
	}

	return {
		isRevealed: () => deps.isRevealed(),
		reveal,
		commit
	};
}
