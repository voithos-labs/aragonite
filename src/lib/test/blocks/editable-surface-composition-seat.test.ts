// @vitest-environment jsdom
// Where a composed run is placed: what a `compositionend` commit writes in each presentation mode,
// with the side the caret meant when the composition opened.
// Miss-analysis: no composition test ran outside live mode, so only keydown checked the mode.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { parseInline } from '$lib/core/inline';
import { createCompositionSeat } from '$lib/components/blocks/text/composition-seat';
import { replaceRangeInLeaf } from '$lib/tree-operations/leaf-range';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { createCaretMemory } from '$lib/cursor/caret-memory';
import { createTypedPlacement } from '$lib/components/blocks/text/edge-seat';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';
import { fixtureReading, topLevelStore } from '../harness/fixture-grammar';

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => {
	__resetLiveJoinSeamCleanerForTests();
	document.body.innerHTML = '';
});

// `Some **bold** text`: strong [5,13), content [7,11), and 11 is the trailing run's near side.
const BOLD = 'Some **bold** text';

interface SeatHarness {
	surface: SurfaceHarness;
	compose: (domAfter: string, caretAt: number) => void;
	selectRange: (start: number, end: number) => void;
}

function makeSeatHarness(source: string, affinity: EdgeAffinity | null): SeatHarness {
	const node = parse(`${source}\n`, { scope: 'fragment' }).children[0];
	let rawSelection: { start: number; end: number } | null = null;
	const caretMemory = createCaretMemory();
	if (affinity === 'far') caretMemory.noteKey({ key: 'ArrowLeft' }, null);
	const getInlines = () => parseInline(source, 0, source.length);
	// The deps read `surface` lazily, so the const below is initialized before any of them run.
	const seat = createCompositionSeat({
		getDisplayText: () => surface.el.textContent ?? '',
		getInlines,
		reading: fixtureReading(),
		consumePendingMarks: () => null,
		restorePendingMarks: () => {},
		getRawSelection: () => rawSelection,
		resolveRangeEdit: (range, typed) => {
			const store = topLevelStore(node, fixtureReading({}, 'live'));
			const edit = replaceRangeInLeaf(node, range, typed, store);
			if (edit.matchesBrowserEdit) return null;
			return { raw: trimTrailingLineEnding(edit.raw), caret: edit.caret };
		}
	});
	const placement = createTypedPlacement({
		getEl: () => surface.el,
		getNode: () => node,
		reading: fixtureReading(),
		caretMemory,
		heldSpace: () => caretMemory.heldSpace.forBlock({})
	});
	const surface = makeSurface({
		relocateComposedText: (after, composedAt) => seat.relocate(after, composedAt),
		caretMemory,
		getNode: () => node,
		overrides: { placeInsertion: placement.insertion }
	});
	surface.el.textContent = source;

	// Browser order as the block wires it: the caret capture first, then the block's own start.
	// The commit leaves the caret after the composed run.
	const compose = (domAfter: string, caretAt: number): void => {
		surface.setCaret(caretAt);
		seat.noteStart();
		surface.surface.onCompositionStart();
		surface.el.textContent = domAfter;
		surface.setCaret(caretAt + domAfter.length - source.length);
		surface.surface.onCompositionEnd();
		seat.noteEnd();
	};
	const selectRange = (start: number, end: number): void => {
		rawSelection = { start, end };
	};
	return { surface, compose, selectRange };
}

describe('the composition caret position is gated on the mode, like its keydown sibling', () => {
	it('source mode commits the DOM read verbatim: the delimiter the caret touched is visible', () => {
		const { surface, compose } = makeSeatHarness(BOLD, 'far');
		compose('Some **boldかん** text', 11);
		expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual([
			'Some **boldかん** text'
		]);
	});

	it('live mode relocates the composed run through the caret position', () => {
		const { surface, compose } = makeSeatHarness(BOLD, 'far');
		surface.el.setAttribute('data-presentation', 'live');
		compose('Some **boldかん** text', 11);
		expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual([
			'Some **bold**かん text'
		]);
	});
});

describe('a composition over a selection takes the join', () => {
	// Selecting [9,21) crosses `**`'s closer and `*`'s opener, so a literal replace leaves both
	// marker runs unpaired on screen.
	const MIXED = 'Some **bold** and *italic* words';

	it('live mode cleans the stranded runs and lands the run at the cleaned join', () => {
		const { surface, compose, selectRange } = makeSeatHarness(MIXED, null);
		surface.el.setAttribute('data-presentation', 'live');
		selectRange(9, 21);
		compose('Some **boかんalic* words', 9);
		expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual([
			'Some boかんalic words'
		]);
	});

	it('a range whose join has nothing to clean stays the verbatim native edit', () => {
		const PLAIN = 'plain words here';
		const { surface, compose, selectRange } = makeSeatHarness(PLAIN, null);
		surface.el.setAttribute('data-presentation', 'live');
		selectRange(5, 11);
		compose('plainかん here', 5);
		expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual(['plainかん here']);
	});
});
