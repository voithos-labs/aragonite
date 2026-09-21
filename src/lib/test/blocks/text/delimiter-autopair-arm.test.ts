// @vitest-environment jsdom
//
// The `beforeinput` handler around the auto-pair resolver: what the block is asked to do with an
// edit, and the check the block lends it, whether the written line still parses as this block.
// The resolver's own table is `delimiter-autopair.test.ts`.
// Miss-analysis: every resolver case sat inside prose, so none typed the second `*` of an
// otherwise empty block and watched `****` reparse as a thematic break.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	applyDelimiterAutoPair,
	type AutoPairSurface
} from '$lib/components/blocks/text/delimiter-autopair';
import { resetPluginPlatformForTests } from '$lib/testing';

interface Recorded {
	writes: [string, number, number][];
	carets: number[];
	outside: number;
}

function surfaceOver(
	text: string,
	caret: number,
	keepsBlockKind: (text: string) => boolean
): AutoPairSurface & Recorded {
	const recorded: Recorded = { writes: [], carets: [], outside: 0 };
	return {
		...recorded,
		text: () => text,
		content: () => ({ start: 0, end: text.length }),
		caret: () => caret,
		hasSelection: () => false,
		isRevealing: () => false,
		foldReveal: () => null,
		markersPaint: () => false,
		setCaret: (offset) => recorded.carets.push(offset),
		seatOutside: () => recorded.outside++,
		write: (next, before, after) => recorded.writes.push([next, before, after]),
		keepsBlockKind,
		get writes() {
			return recorded.writes;
		},
		get carets() {
			return recorded.carets;
		},
		get outside() {
			return recorded.outside;
		}
	};
}

const typed = (data: string) =>
	new InputEvent('beforeinput', { inputType: 'insertText', data, cancelable: true });

describe('the arm keeps the line this block', () => {
	beforeEach(resetPluginPlatformForTests);
	afterEach(resetPluginPlatformForTests);

	// `*|*` plus `*` grows to `****`, a thematic break on a line of its own: the key steps past
	// its partner instead, and a closer typed by hand later completes `**bold**`.
	it('a grow that would re-kind the line steps past the twin', () => {
		const surface = surfaceOver('**', 1, (line) => line !== '****');
		const e = typed('*');
		expect(applyDelimiterAutoPair(e, surface)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(surface.writes).toEqual([]);
		expect(surface.carets).toEqual([2]);
	});

	it('a grow the line survives is written', () => {
		const surface = surfaceOver('**', 1, () => true);
		expect(applyDelimiterAutoPair(typed('*'), surface)).toBe(true);
		expect(surface.writes).toEqual([['****', 1, 2]]);
	});

	// `~|` plus `~` would grow to `~~~~`, a fence opener, and there is no partner to step past.
	it('a grow that would re-kind the line with no twin ahead stays the engine’s byte', () => {
		const surface = surfaceOver('~', 1, (line) => line !== '~~~~');
		const e = typed('~');
		expect(applyDelimiterAutoPair(e, surface)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(surface.writes).toEqual([]);
	});

	it('a closer typed by hand is written and seats the caret outside', () => {
		const surface = surfaceOver('Some *ab', 8, () => true);
		expect(applyDelimiterAutoPair(typed('*'), surface)).toBe(true);
		expect(surface.writes).toEqual([['Some *ab*', 8, 9]]);
		expect(surface.outside).toBe(1);
	});
});
