// @vitest-environment jsdom
//
// The composition seat at its wiring level: what a compositionend commit writes when the seat
// is consulted, per presentation mode. Miss: the seat's mode gate lived only at the keydown
// dispatch; no composition-path test ever ran outside live mode, so the ungated sibling
// relocated bytes a source-mode user placed beside a VISIBLE delimiter.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { parseInline } from '$lib/core/inline';
import { createCompositionSeat } from '$lib/components/blocks/text/composition-seat';
import { resolveSelectionEdit } from '$lib/components/blocks/text/live-selection-edit';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { screenVisibilityOf } from '$lib/cursor/widget-offset';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => {
	__resetLiveJoinSeamCleanerForTests();
	document.body.innerHTML = '';
});

// `Some **bold** text`: strong [5,13), content [7,11) — 11 is the trailing run's near side.
const BOLD = 'Some **bold** text';

interface SeatHarness {
	surface: SurfaceHarness;
	compose: (domAfter: string, caretAt: number) => void;
	selectRange: (start: number, end: number) => void;
}

function makeSeatHarness(source: string, affinity: EdgeAffinity | null): SeatHarness {
	const node = parse(`${source}\n`, { scope: 'fragment' }).children[0];
	let rawSelection: { start: number; end: number } | null = null;
	// The deps read `surface` lazily, so the const below is initialized before any of them run.
	const seat = createCompositionSeat({
		getDisplayText: () => surface.el.textContent ?? '',
		getInlines: () => parseInline(source, 0, source.length),
		getAffinity: () => affinity,
		getScreen: () => screenVisibilityOf(surface.el),
		consumePendingMarks: () => null,
		getRawSelection: () => rawSelection,
		resolveRangeEdit: (range, typed) => {
			const edit = resolveSelectionEdit(node, range, typed, 'live', undefined);
			return edit && { raw: trimTrailingLineEnding(edit.raw), caret: edit.caret };
		}
	});
	const surface = makeSurface(undefined, (after, composedAt) => seat.relocate(after, composedAt));
	surface.el.textContent = source;

	// Browser order as the block wires it: seat capture, then the surface's own start half.
	const compose = (domAfter: string, caretAt: number): void => {
		surface.setCaret(caretAt);
		seat.noteStart();
		surface.surface.onCompositionStart();
		surface.el.textContent = domAfter;
		surface.surface.onCompositionEnd();
		seat.noteEnd();
	};
	const selectRange = (start: number, end: number): void => {
		rawSelection = { start, end };
	};
	return { surface, compose, selectRange };
}

describe('the composition seat is gated on the mode, like its keydown sibling', () => {
	it('source mode commits the DOM read verbatim: the delimiter the caret touched is visible', () => {
		const { surface, compose } = makeSeatHarness(BOLD, 'far');
		compose('Some **boldかん** text', 11);
		expect(surface.commits.map((c) => c.text)).toEqual(['Some **boldかん** text']);
	});

	it('live mode relocates the composed run through the seat', () => {
		const { surface, compose } = makeSeatHarness(BOLD, 'far');
		surface.el.setAttribute('data-presentation', 'live');
		compose('Some **boldかん** text', 11);
		expect(surface.commits.map((c) => c.text)).toEqual(['Some **bold**かん text']);
	});
});

describe('a composition over a selection takes the join seam', () => {
	// Same fixture as live-selection-edit: selecting [9,21) crosses `**`'s closer and `*`'s
	// opener, so the literal replace strands both runs on screen.
	const MIXED = 'Some **bold** and *italic* words';

	it('live mode cleans the stranded runs and lands the run at the cleaned seam', () => {
		const { surface, compose, selectRange } = makeSeatHarness(MIXED, null);
		surface.el.setAttribute('data-presentation', 'live');
		selectRange(9, 21);
		compose('Some **boかんalic* words', 9);
		expect(surface.commits.map((c) => c.text)).toEqual(['Some boかんalic words']);
	});

	it('a range whose seam has nothing to clean stays the verbatim native edit', () => {
		const PLAIN = 'plain words here';
		const { surface, compose, selectRange } = makeSeatHarness(PLAIN, null);
		surface.el.setAttribute('data-presentation', 'live');
		selectRange(5, 11);
		compose('plainかん here', 5);
		expect(surface.commits.map((c) => c.text)).toEqual(['plainかん here']);
	});
});
