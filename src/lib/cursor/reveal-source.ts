/**
 * Rendered↔source reveal: swaps an opaque rendered view for its editable raw
 * source and back, placing the caret via the `widget-offset` helpers only —
 * offset translation has one home (`cursor/widget-offset.ts`). Two consumers
 * share this caret core over two different swaps:
 *
 *   INLINE — a reveal-capable [data-inline-widget] island inside a
 *     contenteditable paragraph (inline math, directive text). Its swap is an
 *     imperative span↔text-node replace; the container is the always-editable
 *     paragraph, which stays focused across the swap.
 *   BLOCK — a render-primary leaf block (block math, a rendered directive). Its
 *     swap is a reactive render↔source `$state` toggle; the source contenteditable
 *     is MOUNTED on reveal and UNMOUNTED on commit, so `container` is null while
 *     rendered.
 *
 * The swap itself is injected (`showSource`/`showRendered`) and the revealed
 * state is owned by the consumer (`isRevealed`), so this primitive stays swap-
 * agnostic and never double-tracks the flag. Everything below the swap — clamp,
 * `tick()`, ambient conversion, caret placement — is the genuinely shared kernel.
 *
 * CARET-LANDING RULE:
 *   reveal(atSourceOffset?)  entry — caret at source `sourceStart + atSourceOffset`,
 *                            clamped to [sourceStart, sourceEnd]; default leading
 *                            edge (0). A click into rendered output can't map to a
 *                            source glyph, so entry honors a REQUESTED offset or
 *                            lands on an edge — never an arbitrary interior point.
 *   commit()                 exit  — caret at the source's TRAILING edge
 *                            (`sourceEnd`). Inline uses this for Escape-cancel
 *                            (rebuild the widget, caret after it). Block commits
 *                            on blur via a CST update instead, so its `container`
 *                            is already unmounted here and the placement self-
 *                            cancels — a re-render must not yank focus back.
 *
 * FOCUS. reveal focuses the settled container before placing the caret, but only
 * when it is not already active. Inline's paragraph is already focused (no-op);
 * block's freshly-mounted source contenteditable is not, and a caret placed in an
 * unfocused editable would not receive typing. Focusing BEFORE the caret write
 * (not after) avoids the browser resetting the selection to the element start.
 *
 * AMBIENT-INCLUDED OFFSETS (load-bearing). `sourceStart`/`sourceEnd`/`atSourceOffset`
 * are BLOCK-source offsets — they exclude the rendered marker prefix a container
 * block contributes (list item, blockquote). The `widget-offset` DOM walk counts
 * that marker text, so a source offset is converted to walk space as
 * `getAmbientLength() + offset` at the single `placeCaret` seam — the same
 * conversion as `TextEditableBlock`'s `createRangeAtRawOffsets(el, ambientLength +
 * start, …)`. Ambient is 0 for a plain paragraph or a top-level block, nonzero
 * inside a marker prefix; feeding the bare block offset to the walk mis-lands the
 * caret by exactly ambient.
 *
 * POST-RENDER CARET. reveal/commit flip the view, then `await tick()` so the caret
 * lands after the swap settles — the only permitted sequencing (no setTimeout/rAF).
 * The inline swap is a synchronous DOM replace; the tick is what lets a reactive
 * consumer's mount/re-render settle first (the block case).
 *
 * PRECONDITION: `source.length === sourceEnd - sourceStart`. The source's raw
 * length equals its source-text length, so every raw offset OUTSIDE it is stable
 * across the swap and the walk stays consistent (revealing never mutates raw).
 */

import { tick } from 'svelte';
import { asRawOffset, toDomTextOffset } from './coordinate-spaces';
import { createRangeAtRawOffsets } from './widget-offset';

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
		const target = toDomTextOffset(asRawOffset(blockSourceOffset), deps.getAmbientLength());
		const range = createRangeAtRawOffsets(container, target, target);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	async function reveal(atSourceOffset = 0): Promise<void> {
		if (!deps.isRevealed()) deps.showSource();
		if (!deps.isRevealed()) return; // swap declined (island not in the DOM)
		await tick();
		const settled = deps.container;
		if (!settled) return;
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
