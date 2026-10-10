/**
 * A code chip's border is an arrow stop of its own (live-mode.md § 4.2): at the chip's edge a plain
 * arrow first moves which side of the border the caret means, and only the next press moves the
 * caret. A click and an arrival by ArrowLeft or End name a side too. A mark's edge has no stop: the
 * next letter takes the format of the character before the caret.
 */

import type { InlineNode } from '../../../core/nodes';
import type { CaretMemory } from '../../../caret/caret-memory';
import { chipArrivalKey, edgeStepDirection } from '../../../caret/edge-affinity';
import { revealsNoMarkers, screenVisibilityOf } from '../../../caret/widget-offset';
import type { Reading } from '../../../schema/reading';
import { chipStops, edgeStep, seatOffsetsAt } from './edge-seat';

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
	/** A click at a code chip's edge meant this side of its border. */
	pinChipSide(side: 'inside' | 'outside'): void;
	/** The browser moved the caret for the last key; at a chip's edge, ArrowLeft and End leave it
	 *  on the side it came from, past the border. */
	settleArrival(): void;
}

export function createEdgeStep(deps: EdgeStepDeps): EdgeStep {
	// The plain key whose move the browser makes, read at the selection change it causes.
	let arrival: 'ArrowLeft' | 'End' | null = null;

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

	/** The caret's chip stops, where it sits at a chip's border in a block that hides markers. */
	function stopsHere(): { inside: number; outside: number } | null {
		const el = hidingEl();
		const caret = deps.getCaret();
		if (!el || caret === null) return null;
		const screen = screenVisibilityOf(el);
		return chipStops(caret, deps.getInlines(), deps.getRaw(), screen, deps.reading);
	}

	function step(e: KeyboardEvent): boolean {
		arrival = chipArrivalKey(e);
		const direction = edgeStepDirection(e);
		const el = hidingEl();
		const caret = deps.getCaret();
		if (direction === null || !el || caret === null) return false;
		const target = edgeStep(
			caret,
			deps.getInlines(),
			deps.caretMemory.side(),
			deps.getRaw(),
			screenVisibilityOf(el),
			deps.reading,
			direction
		);
		if (target === null) return false;
		arrival = null;
		deps.caretMemory.pin(target);
		return true;
	}

	return {
		step,
		hiddenRunAt,
		pinChipSide: (side) => {
			const stops = stopsHere();
			if (stops) deps.caretMemory.pin(stops[side]);
		},
		settleArrival: () => {
			const key = arrival;
			arrival = null;
			const stops = key && stopsHere();
			// ArrowLeft arrives from the right-hand side; End only ever lands at a closer.
			if (stops) deps.caretMemory.pin(Math.max(stops.inside, stops.outside));
		}
	};
}
