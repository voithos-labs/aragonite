/**
 * Rendered↔source reveal for an atomic inline widget. A widget renders as an
 * opaque [data-inline-widget] island standing for its `$…$`-style raw bytes;
 * this swaps it to editable source text and back, placing the caret via the
 * `widget-offset` helpers only — offset translation has one home
 * (`cursor/widget-offset.ts`).
 *
 * SCOPE. The imperative span-swap here IS the inline math mechanism — a
 * [data-inline-widget] child of a contenteditable. The genuinely reusable part is
 * the caret core below (clamp → ambient conversion → post-`tick()` placement).
 * Block math (render-primary, source-on-focus, no widget span) toggles reactively,
 * so it reuses that core but abstracts the swap itself; that seam is resolved at
 * the block-component task when the block DOM is concrete, not generalized here.
 *
 * CARET-LANDING RULE:
 *   reveal(atSourceOffset?)  entry — caret at source `sourceStart + atSourceOffset`,
 *                            clamped to [sourceStart, sourceEnd]; default leading
 *                            edge (0). A click into rendered output can't map to a
 *                            source glyph, so entry honors a REQUESTED offset or
 *                            lands on an edge — never an arbitrary interior point.
 *   commit()                 exit  — caret at the widget's TRAILING edge, source
 *                            offset === sourceEnd (the node's `end`).
 *
 * AMBIENT-INCLUDED OFFSETS (load-bearing). `sourceStart`/`sourceEnd`/`atSourceOffset`
 * are BLOCK-source offsets — they exclude the rendered marker prefix a container
 * block contributes (list item, blockquote). The `widget-offset` DOM walk counts
 * that marker text, so a source offset is converted to walk space as
 * `getAmbientLength() + offset` at the single `placeCaret` seam — the same
 * conversion as `TextEditableBlock`'s `createRangeAtRawOffsets(el, ambientLength +
 * start, …)`. Ambient is 0 for a plain paragraph, nonzero inside a marker prefix;
 * feeding the bare block offset to the walk mis-lands the caret by exactly ambient.
 *
 * POST-RENDER CARET. reveal/commit flip the rendered↔source view, then `await
 * tick()` so the caret lands after the swap settles — the only permitted
 * sequencing (no setTimeout/rAF). The swap here is a synchronous DOM replace; the
 * tick is what lets a reactive consumer's re-render settle first (block math).
 *
 * PRECONDITION: `source.length === sourceEnd - sourceStart`. The widget's raw
 * length equals its source-text length, so every raw offset OUTSIDE the widget is
 * stable across the swap and the walk stays consistent (math never mutates raw).
 */

import { tick } from 'svelte';
import { createRangeAtRawOffsets } from './widget-offset';

export interface SourceRevealDeps {
	/** The block's contenteditable host — where the offset walk runs. */
	get container(): HTMLElement | null;
	/** Widget node's raw byte range [start, end) in the block source. */
	get sourceStart(): number;
	get sourceEnd(): number;
	/** The widget's raw source bytes; `length` MUST equal `sourceEnd - sourceStart`. */
	get source(): string;
	/** Rendered marker prefix length the DOM walk counts but block source excludes. */
	getAmbientLength(): number;
	/** Builds a fresh opaque widget ([data-inline-widget] + data-source-*). Injected —
	 *  the LaTeX consumer injects a KaTeX-backed builder; the renderer is not owned here. */
	renderWidget(): HTMLElement;
}

export interface SourceReveal {
	isRevealed(): boolean;
	/** Swap to editable source; caret at `sourceStart + atSourceOffset` (default edge). */
	reveal(atSourceOffset?: number): Promise<void>;
	/** Swap back to the rendered widget; caret at the trailing edge (`sourceEnd`). */
	commit(): Promise<void>;
}

export function createSourceReveal(deps: SourceRevealDeps): SourceReveal {
	let sourceNode: Text | null = null;

	/** Places the caret at a BLOCK-source offset, converting to ambient-included walk space. */
	function placeCaret(container: HTMLElement, blockSourceOffset: number): void {
		const target = deps.getAmbientLength() + blockSourceOffset;
		const range = createRangeAtRawOffsets(container, target, target);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	async function reveal(atSourceOffset = 0): Promise<void> {
		const container = deps.container;
		if (!container) return;
		if (sourceNode === null) {
			const widget = container.querySelector<HTMLElement>(
				`[data-inline-widget][data-source-start="${deps.sourceStart}"]`
			);
			if (!widget) return;
			sourceNode = document.createTextNode(deps.source);
			widget.replaceWith(sourceNode);
		}
		await tick();
		const settled = deps.container;
		if (!settled) return;
		const clamped = Math.max(0, Math.min(atSourceOffset, deps.source.length));
		placeCaret(settled, deps.sourceStart + clamped);
	}

	async function commit(): Promise<void> {
		const container = deps.container;
		if (!container || sourceNode === null) return;
		sourceNode.replaceWith(deps.renderWidget());
		sourceNode = null;
		await tick();
		const settled = deps.container;
		if (!settled) return;
		placeCaret(settled, deps.sourceEnd);
	}

	return {
		isRevealed: () => sourceNode !== null,
		reveal,
		commit
	};
}
