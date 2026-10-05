/**
 * A hidden construct edge is an arrow stop of its own (live-mode.md § 4.2): after `code` in
 * `` `code` `` a plain arrow first moves which offset the caret means, inside the closer or past
 * it, and only the next press moves the caret. Both offsets share a pixel, so each construct the
 * next byte would join carries `EDGE_HELD_CLASS`.
 */

import type { InlineNode } from '../../../core/nodes';
import type { CaretMemory } from '../../../cursor/caret-memory';
import { constructContentRange, inlineDescendants } from '../../../core/inline';
import { revealsNoMarkers, screenVisibilityOf } from '../../../cursor/widget-offset';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';
import type { Reading } from '../../../schema/reading';
import { edgeStep, edgeStops, seatOffsetsAt, typingOffset } from './edge-seat';

/** On a construct's content element while the caret sits at its hidden edge, inside it. */
export const EDGE_HELD_CLASS = 'md-edge-held';

export interface EdgeStepDeps {
	getEl: () => HTMLElement | null;
	/** The block's own bytes, in the coordinates the caret counts in. */
	getRaw: () => string;
	getInlines: () => readonly InlineNode[];
	/** The collapsed caret's raw offset, or null for a range or no caret. */
	getCaret: () => number | null;
	/** Reading mode takes no bytes, so which side a byte would land on means nothing there. */
	isReading: () => boolean;
	/** The reading `getInlines` was read with, so a reference link reads as one. */
	reading: Reading;
	caretMemory: Pick<CaretMemory, 'side' | 'pin'>;
}

export interface EdgeStep {
	/** The `stepEdge` a surface hands its shared keydown. */
	step(e: KeyboardEvent): boolean;
	/** Whether a marker run the screen hides touches `caret`, where a typed closer moves only the
	 *  side the caret means. */
	hiddenRunAt(caret: number): boolean;
	/** Mark the constructs the next byte would join again; cheap where no edge is touched. Call
	 *  it after anything that can move the caret or its side: a selection change, a key, a render. */
	show(): void;
}

export function createEdgeStep(deps: EdgeStepDeps): EdgeStep {
	let held: Element[] = [];

	/** The block's element where its screen hides markers at the caret: elsewhere every delimiter
	 *  is a byte on screen, which the arrow and a typed closer already step over. */
	function hidingEl(): HTMLElement | null {
		const el = deps.getEl();
		return el && !deps.isReading() && revealsNoMarkers(el) ? el : null;
	}

	function hiddenRunAt(caret: number): boolean {
		const el = hidingEl();
		if (!el) return false;
		const screen = screenVisibilityOf(el);
		return (
			seatOffsetsAt(caret, deps.getInlines(), deps.getRaw(), screen, deps.reading.grammar).length >
			0
		);
	}

	/** The caret's position and the block's reading of it, where a hidden edge has a choice. */
	function edge(): { el: HTMLElement; caret: number; stops: number[] } | null {
		const el = hidingEl();
		if (!el || !document.hasFocus()) return null;
		const caret = deps.getCaret();
		if (caret === null) return null;
		const stops = edgeStops(
			caret,
			deps.getInlines(),
			deps.getRaw(),
			screenVisibilityOf(el),
			deps.reading
		);
		return stops.length < 2 ? null : { el, caret, stops };
	}

	function step(e: KeyboardEvent): boolean {
		const direction =
			e.key === 'ArrowRight' ? 'forward' : e.key === 'ArrowLeft' ? 'backward' : null;
		if (direction === null) return false;
		// Shift extends a range, Ctrl/Alt jump a word, Meta jumps the line: each moves by more than
		// one boundary, so none of them stops at a hidden edge.
		if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return false;
		const at = edge();
		if (!at) return false;
		const target = edgeStep(
			at.caret,
			deps.getInlines(),
			deps.caretMemory.side(),
			deps.getRaw(),
			screenVisibilityOf(at.el),
			deps.reading,
			direction
		);
		if (target === null) return false;
		deps.caretMemory.pin(target);
		show();
		return true;
	}

	function show(): void {
		const next = heldElements();
		for (const node of held) if (!next.includes(node)) node.classList.remove(EDGE_HELD_CLASS);
		for (const node of next) node.classList.add(EDGE_HELD_CLASS);
		held = next;
	}

	/** The content elements, at this position, the next byte would land inside: decided on the
	 *  tree, then found by the construct tags on the opener, whose next sibling is the content. */
	function heldElements(): Element[] {
		const at = edge();
		if (!at) return [];
		const inlines = deps.getInlines();
		const typing = typingOffset(
			at.caret,
			inlines,
			deps.caretMemory.side(),
			deps.getRaw(),
			screenVisibilityOf(at.el),
			deps.reading
		);
		const lo = at.stops[0];
		const hi = at.stops[at.stops.length - 1];
		const within = (offset: number) => offset >= lo && offset <= hi;
		const inside = new Set<string>();
		for (const node of inlineDescendants(inlines)) {
			// A never-extend construct takes no byte at its edge, so there is no side to show.
			if (getInlineConstructPolicy(node.kind)?.edgeAffinity !== 'symmetric-pair') continue;
			const content = constructContentRange(node);
			if (!content || !(within(content.start) || within(content.end))) continue;
			if (content.start <= typing && typing <= content.end) inside.add(`${node.start}:${node.end}`);
		}
		if (inside.size === 0) return [];
		const found: Element[] = [];
		for (const marker of at.el.querySelectorAll('[data-construct-start]')) {
			const key = `${marker.getAttribute('data-construct-start')}:${marker.getAttribute('data-construct-end')}`;
			if (!inside.has(key)) continue;
			// The first tagged span of a construct is its opener, so its content is the next sibling.
			inside.delete(key);
			const content = marker.nextSibling;
			if (content instanceof Element && !content.hasAttribute('data-construct-start'))
				found.push(content);
		}
		return found;
	}

	return { step, hiddenRunAt, show };
}
