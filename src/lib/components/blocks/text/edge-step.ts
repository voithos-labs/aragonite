/**
 * A code chip's border is an arrow stop of its own (live-mode.md § 4.2): at the chip's edge a plain
 * arrow first moves which side of the border the caret means, and only the next press moves the
 * caret. Each construct the next byte would join at a chip's edge or a held space carries
 * `EDGE_HELD_CLASS`.
 */

import type { InlineNode } from '../../../core/nodes';
import type { CaretMemory } from '../../../caret/caret-memory';
import type { HeldSpaceView } from '../../../caret/held-space';
import { constructContentRange, inlineDescendants } from '../../../core/inline';
import { classifyCaretKey, edgeStepDirection } from '../../../caret/edge-affinity';
import { revealsNoMarkers, screenVisibilityOf } from '../../../caret/widget-offset';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';
import type { Reading } from '../../../schema/reading';
import type { NextByte } from '../../../caret/caret-look';
import { edgeStep, edgeStops, seatOffsetsAt } from './edge-seat';

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
	/** The block's held space, read lazily: the block makes it after the edge step. */
	heldSpace: () => HeldSpaceView;
	/** The formats a letter typed at a raw offset would carry, the answer the drawn caret paints;
	 *  read lazily, like the held space. */
	nextByte: (caret: number) => NextByte;
}

export interface EdgeStep {
	/** The `stepEdge` a surface hands its shared keydown. */
	step(e: KeyboardEvent): boolean;
	/** Whether a marker run the screen hides touches `caret`, where a typed closer moves only the
	 *  side the caret means. */
	hiddenRunAt(caret: number): boolean;
	/** Marks the constructs the next byte would join, after the caret, its side or the focus moved;
	 *  a block the caret is not in only clears what it marked. */
	sync(): void;
	/** `sync` after a render, which leaves fresh spans unmarked; a block that marked nothing waits
	 *  for the selection change that follows. */
	refresh(): void;
	/** `sync` after a key that can move the side without moving the caret, Home at a line start. */
	afterKey(e: KeyboardEvent): void;
}

export function createEdgeStep(deps: EdgeStepDeps): EdgeStep {
	let held: Element[] = [];
	// A key whose caret move already fired a selection change needs no second look on keyup.
	let keySinceSync = false;

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
		const offsets = seatOffsetsAt(
			caret,
			deps.getInlines(),
			deps.getRaw(),
			screen,
			deps.reading.grammar
		);
		return offsets.length > 0;
	}

	/** The caret's position and the block's reading of it, where a hidden edge has a choice. */
	function edge(): { el: HTMLElement; caret: number; stops: number[] } | null {
		const el = edgeHost();
		if (!el) return null;
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
		keySinceSync = true;
		const direction = edgeStepDirection(e);
		if (direction === null) return false;
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
		mark(heldElements(at));
		keySinceSync = false;
		return true;
	}

	function sync(): void {
		keySinceSync = false;
		if (edgeHost()) mark(heldElements(edge() ?? heldSpaceStop()));
		else if (held.length > 0) mark([]);
	}

	/** A held space's construct, as the one stop where its closer is: the caret sits past it. */
	function heldSpaceStop(): ReturnType<typeof edge> {
		const el = edgeHost();
		const caret = deps.getCaret();
		const inside = caret === null ? null : heldSpaceAt(caret);
		return el && caret !== null && inside !== null ? { el, caret, stops: [inside] } : null;
	}

	/** Where the next letter joins the construct while a space typed at its hidden closer is held
	 *  at `caret`, or null. */
	function heldSpaceAt(caret: number): number | null {
		const view = deps.heldSpace();
		return hidingEl() && view.at() === caret ? view.inside() : null;
	}

	/** The block while it has the focus, hides markers at the caret and holds a construct: the one
	 *  block an edge can concern, found without reading the selection, since every block asks. */
	function edgeHost(): HTMLElement | null {
		const el = hidingEl();
		if (!el || !el.contains(document.activeElement) || !document.hasFocus()) return null;
		return deps.getInlines().some((node) => node.kind !== 'text') ? el : null;
	}

	function mark(next: Element[]): void {
		for (const node of held) if (!next.includes(node)) node.classList.remove(EDGE_HELD_CLASS);
		for (const node of next) node.classList.add(EDGE_HELD_CLASS);
		held = next;
	}

	/** The content elements at this edge of the very constructs the next letter would sit inside,
	 *  found by the construct tags on the opener, whose next sibling is the content. */
	function heldElements(at: ReturnType<typeof edge>): Element[] {
		if (!at) return [];
		const holders = deps.nextByte(at.caret).holders;
		if (holders.length === 0) return [];
		// By kind and start, not kind alone: two constructs of one kind can meet at one edge.
		const carried = new Set(holders.map((holder) => `${holder.kind}@${holder.start}`));
		const lo = at.stops[0];
		const hi = at.stops[at.stops.length - 1];
		const within = (offset: number) => offset >= lo && offset <= hi;
		const inside = new Set<string>();
		for (const node of inlineDescendants(deps.getInlines())) {
			// A never-extend construct takes no byte at its edge, so there is no side to show.
			const edgePolicy = getInlineConstructPolicy(node.kind)?.edgeAffinity;
			if (!edgePolicy || edgePolicy === 'never-extend') continue;
			const content = constructContentRange(node);
			if (!content || !(within(content.start) || within(content.end))) continue;
			if (carried.has(`${node.kind}@${node.start}`)) inside.add(`${node.start}:${node.end}`);
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

	return {
		step,
		hiddenRunAt,
		sync,
		refresh: () => {
			if (held.length > 0) sync();
		},
		afterKey: (e) => {
			if (keySinceSync && classifyCaretKey(e.key) !== 'preserve') sync();
		}
	};
}
