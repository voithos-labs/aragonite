/**
 * A code chip's border is an arrow stop of its own (live-mode.md § 4.2): at the chip's edge a plain
 * arrow first moves which side of the border the caret means, and only the next press moves the
 * caret. A click and an arrival by ArrowLeft or the line-end key name a side too. A mark's edge
 * has no stop: the next letter takes the format of the character before the caret.
 */

import type { InlineNode } from '../../../core/nodes';
import type { CaretMemory } from '../../../caret/caret-memory';
import type { CaretWriter } from '../../../browser/caret-writer';
import { chipArrivalKey, edgeStepDirection } from '../../../caret/edge-affinity';
import { hidingScreenOf } from '../../../browser/painted';
import { caretEdgeKey } from '../../../schema/keybindings';
import type { Reading } from '../../../schema/reading';
import { hiddenEdges, type HiddenEdges } from './edge-seat';

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
	caretWriter: Pick<CaretWriter, 'moveCaretToLineEdge'>;
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
	/** The block's hidden runs where its screen hides markers at the caret: elsewhere every
	 *  delimiter is a byte on screen, which the arrow and a typed closer already step over. */
	function edgesNow(): HiddenEdges | null {
		const screen = deps.isReading() ? null : hidingScreenOf(deps.getEl());
		return screen && hiddenEdges(deps.getInlines(), deps.getRaw(), screen, deps.reading);
	}

	/** Where ArrowLeft or the line-end key will land the caret, in raw offsets: one character left,
	 *  or the end of the caret's raw line, which is past a chip ending that line. */
	function landing(e: KeyboardEvent, caret: number): number | null {
		const key = chipArrivalKey(e);
		const raw = deps.getRaw();
		if (key === 'lineEnd') {
			const end = raw.indexOf('\n', caret);
			return end === -1 ? raw.length : end;
		}
		if (key !== 'ArrowLeft' || caret === 0) return null;
		const low = raw.charCodeAt(caret - 1);
		return caret - (low >= 0xdc00 && low <= 0xdfff ? 2 : 1);
	}

	function step(e: KeyboardEvent): boolean {
		const caret = deps.getCaret();
		const direction = edgeStepDirection(e);
		const at = caret === null ? null : landing(e, caret);
		// Only an arrow or the line-end key asks the edge anything, so a typed key reads no runs.
		const edges = caret !== null && (direction !== null || at !== null) ? edgesNow() : null;
		if (direction !== null && edges && caret !== null) {
			const target = edges.edgeStep(caret, deps.caretMemory.side(), direction);
			if (target !== null) {
				deps.caretMemory.pin(target);
				return true;
			}
		}
		// ArrowLeft onto a chip from its right, and the line-end key past a chip ending the line, both
		// mean the right-hand stop, decided here so no paint shows the other.
		const stops = edges && at !== null ? edges.chipStops(at) : null;
		deps.caretMemory.pinOnArrival(e, stops && Math.max(stops.inside, stops.outside));
		// Only macOS moves the caret for Cmd+Right, so the arrival it pinned is placed here.
		if (stops && chipArrivalKey(e) === 'lineEnd' && caretEdgeKey(e)?.arrow) {
			e.preventDefault();
			deps.caretWriter.moveCaretToLineEdge('end');
		}
		return false;
	}

	return {
		step,
		hiddenRunAt: (caret) => (edgesNow()?.seatOffsets(caret).length ?? 0) > 0,
		pinChipSide: (side) => {
			const caret = deps.getCaret();
			const stops = caret === null ? null : edgesNow()?.chipStops(caret);
			if (stops) deps.caretMemory.pin(stops[side]);
		}
	};
}
