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
	caretMemory: Pick<CaretMemory, 'side' | 'pin' | 'pinOnArrival'>;
}

export interface EdgeStep {
	/** The `stepEdge` a surface hands its shared keydown. */
	step(e: KeyboardEvent): boolean;
	/** Whether a marker run the screen hides touches `caret`, where a typed closer moves only the
	 *  side the caret means. */
	hiddenRunAt(caret: number): boolean;
	/** A click at a code chip's edge meant this side of its border. */
	pinChipSide(side: 'inside' | 'outside'): void;
}

export function createEdgeStep(deps: EdgeStepDeps): EdgeStep {
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

	/** The chip stops at `at`, where it is a chip's border in a block that hides markers. */
	function stopsAt(at: number | null): { inside: number; outside: number } | null {
		const el = hidingEl();
		if (!el || at === null) return null;
		const screen = screenVisibilityOf(el);
		return chipStops(at, deps.getInlines(), deps.getRaw(), screen, deps.reading);
	}

	/** Where ArrowLeft or End will land the caret, in raw offsets: one character left, or the end
	 *  of the caret's raw line, which is past a chip ending that line. */
	function landing(e: KeyboardEvent, caret: number): number | null {
		const key = chipArrivalKey(e);
		const raw = deps.getRaw();
		if (key === 'End') {
			const end = raw.indexOf('\n', caret);
			return end === -1 ? raw.length : end;
		}
		if (key !== 'ArrowLeft' || caret === 0) return null;
		const low = raw.charCodeAt(caret - 1);
		return caret - (low >= 0xdc00 && low <= 0xdfff ? 2 : 1);
	}

	function step(e: KeyboardEvent): boolean {
		const caret = deps.getCaret();
		const el = hidingEl();
		const direction = edgeStepDirection(e);
		if (direction !== null && el && caret !== null) {
			const target = edgeStep(
				caret,
				deps.getInlines(),
				deps.caretMemory.side(),
				deps.getRaw(),
				screenVisibilityOf(el),
				deps.reading,
				direction
			);
			if (target !== null) {
				deps.caretMemory.pin(target);
				return true;
			}
		}
		// ArrowLeft arrives at a chip's edge from its right-hand side, and End lands past a chip
		// ending the line: both mean the right-hand stop, decided here so no paint shows the other.
		const stops = caret === null ? null : stopsAt(landing(e, caret));
		deps.caretMemory.pinOnArrival(e, stops && Math.max(stops.inside, stops.outside));
		return false;
	}

	return {
		step,
		hiddenRunAt,
		pinChipSide: (side) => {
			const stops = stopsAt(deps.getCaret());
			if (stops) deps.caretMemory.pin(stops[side]);
		}
	};
}
