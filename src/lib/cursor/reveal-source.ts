/**
 * Rendered↔source reveal: the caret kernel shared by the inline-island and
 * render-primary-block swaps (both injected, along with the revealed flag). Placement runs
 * only through `cursor/widget-offset.ts`, offset translation's one home, converting
 * block-source offsets to walk space by `+ getAmbientLength()` at the single `placeCaret`
 * seam. Precondition `source.length === sourceEnd - sourceStart`, asserted at entry (G1.26).
 */

import { tick } from 'svelte';
import { asRawOffset, toDomTextOffset } from './coordinate-spaces';
import { restoreCaretAtWalkOffset } from './focused-caret';
import { assertInvariant } from '../assert';
import { checkRevealSourceLength } from '../invariants/inline-transitions';

export interface SourceRevealDeps {
	/** The block's contenteditable host — where the offset walk runs. Null while a
	 *  reactive consumer has the source unmounted (the block case, while rendered). */
	get container(): HTMLElement | null;
	/** Source's raw byte range [start, end) in the block source. */
	get sourceStart(): number;
	get sourceEnd(): number;
	/** The source's raw bytes; `length` MUST equal `sourceEnd - sourceStart`. */
	get source(): string;
	/** Rendered marker prefix length the DOM walk counts but block source excludes. */
	getAmbientLength(): number;
	/** Whether the editable source is currently shown. Owned by the consumer
	 *  (inline: a captured text node; block: a reactive flag). */
	isRevealed(): boolean;
	/** Swap the rendered view for editable source. May decline (leave `isRevealed`
	 *  false) — e.g. the inline widget island isn't in the DOM. */
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
	/** Places the caret at a BLOCK-source offset, converting to ambient-included walk space. */
	function placeCaret(container: HTMLElement, blockSourceOffset: number): void {
		const walkOffset = toDomTextOffset(asRawOffset(blockSourceOffset), deps.getAmbientLength());
		restoreCaretAtWalkOffset(container, walkOffset);
	}

	async function reveal(atSourceOffset = 0): Promise<void> {
		assertInvariant('reveal-transition', () =>
			checkRevealSourceLength(deps.source.length, deps.sourceStart, deps.sourceEnd)
		);
		if (!deps.isRevealed()) deps.showSource();
		if (!deps.isRevealed()) return; // swap declined (island not in the DOM)
		await tick();
		const settled = deps.container;
		if (!settled) return;
		// Focus BEFORE the caret write: a caret placed in an unfocused editable receives no
		// typing, and focusing after would reset the selection to the element start.
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
