/**
 * Rendered↔source reveal for an atomic inline widget (spike seeding Task 10's
 * `createSourceReveal`). A widget renders as an opaque [data-inline-widget]
 * island standing for its `$…$`-style raw bytes; this swaps it to editable
 * source text and back, placing the caret via the `widget-offset` helpers only —
 * offset translation has one home (`cursor/widget-offset.ts`).
 *
 * CARET-LANDING RULE (the model this spike proves):
 *   reveal(atSourceOffset?)  entry — caret at raw `sourceStart + atSourceOffset`,
 *                            clamped to [sourceStart, sourceEnd]. Default is the
 *                            leading edge (offset 0). A click into rendered output
 *                            can't map to a source glyph, so entry honors a
 *                            REQUESTED offset or lands on an edge — never guesses
 *                            an arbitrary interior point.
 *   commit()                 exit  — caret at the widget's TRAILING edge,
 *                            raw offset === sourceEnd (the node's `end`).
 *
 * PRECONDITION: `source.length === sourceEnd - sourceStart`. The widget's raw
 * length equals its source text length, so every raw offset OUTSIDE the widget is
 * stable across the swap and the walk stays consistent (math never mutates raw).
 *
 * SCOPE (spike): synchronous DOM swap in an ambient-free surface. It proves the
 * OFFSET model, not re-render timing — Task 10 owns post-`tick()` caret placement
 * once commit flips a reactive flag, and ambient layering rides on top via the
 * `ambient/` helpers.
 */

import { createRangeAtRawOffsets } from './widget-offset';

export interface SourceRevealDeps {
	/** The block's contenteditable host — where the offset walk runs. */
	get container(): HTMLElement | null;
	/** Widget node's raw byte range [start, end) in the block source. */
	get sourceStart(): number;
	get sourceEnd(): number;
	/** The widget's raw source bytes; `length` MUST equal `sourceEnd - sourceStart`. */
	get source(): string;
	/** Builds a fresh opaque widget ([data-inline-widget] + data-source-*). Injected —
	 *  the spike stubs it; the LaTeX consumer injects a KaTeX-backed builder. */
	renderWidget(): HTMLElement;
}

export interface SourceReveal {
	isRevealed(): boolean;
	/** Swap to editable source; caret at `sourceStart + atSourceOffset` (default edge). */
	reveal(atSourceOffset?: number): void;
	/** Swap back to the rendered widget; caret at the trailing edge (`sourceEnd`). */
	commit(): void;
}

export function createSourceReveal(deps: SourceRevealDeps): SourceReveal {
	let sourceNode: Text | null = null;

	function placeCaret(container: HTMLElement, rawOffset: number): void {
		const range = createRangeAtRawOffsets(container, rawOffset, rawOffset);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function reveal(atSourceOffset = 0): void {
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
		const clamped = Math.max(0, Math.min(atSourceOffset, deps.source.length));
		placeCaret(container, deps.sourceStart + clamped);
	}

	function commit(): void {
		const container = deps.container;
		if (!container || sourceNode === null) return;
		const widget = deps.renderWidget();
		sourceNode.replaceWith(widget);
		sourceNode = null;
		placeCaret(container, deps.sourceEnd);
	}

	return {
		isRevealed: () => sourceNode !== null,
		reveal,
		commit
	};
}
