// @vitest-environment jsdom
//
// Where the caret-edge dispatch puts a typed byte. A printable key at an inline construct's
// hidden delimiter run writes its byte through the CST at the offset the policy and the arrival
// side name, because Chromium moves a collapsed caret back across a run it does not render, so
// moving the DOM caret past that run is undone before the insertion.
// Miss-analysis: the policy entry and the arrival side both shipped with no consumer, so nothing
// could disagree with them; this is the level where the two meet.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import {
	at,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountSurface,
	type EdgeDispatchHarness
} from './edge-policy-fixture';

/** `source` as one block under a presentation root, with `affinity` on record. */
function mount(
	source: string,
	mode: string,
	affinity: EdgeAffinity | null,
	isReading = false
): EdgeDispatchHarness {
	const node = parse(source).children[0];
	const el = mountSurface(trimTrailingLineEnding(node.raw), mode);
	return makeEdgeDispatch(node, el, {
		isReading: () => isReading,
		getEdgeAffinity: () => affinity
	});
}

installEdgeDispatchCleanup();

const BOLD = 'Some **bold** text\n';

describe('a symmetric pair extends or not by the arrival on record', () => {
	it('declines the near side, leaving the byte to native insertion', () => {
		const h = mount(BOLD, 'live', 'near');
		expect(h.handleKeydown(key('X'), at(11))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('writes past the closing run when the arrival came from the far side', () => {
		const h = mount(BOLD, 'live', 'far');
		const e = key('X');
		expect(h.handleKeydown(e, at(11))).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		// `caretBefore` is the caret before the byte moved, so Ctrl+Z lands where the user typed.
		expect(h.edits).toEqual([[0, 'Some **bold**X text\n', 11, 14]]);
	});

	it('writes inside the opening run when the arrival came from the far side', () => {
		const h = mount(BOLD, 'live', 'far');
		expect(h.handleKeydown(key('X'), at(5))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **Xbold** text\n', 5, 8]]);
	});

	// A click resets the arrival side, so the default is what a click means (live-mode.md § 4.2).
	// These rules decide where the byte lands; what a delimiter keystroke writes there is still
	// the auto-pair's answer, or a byte placed past the closer would arrive without its partner.
	// Miss-analysis: every case here typed a letter, so the `beforeinput` auto-pair, which keydown
	// pre-empts by writing first, was never asked about a delimiter placed this way.
	it('writes a delimiter’s twin at the seat, not a lone byte', () => {
		const h = mount(BOLD, 'live', 'far');
		expect(h.handleKeydown(key('`'), at(11))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bold**`` text\n', 11, 14]]);
	});

	it('declines with no arrival on record — a click keeps the construct’s near side', () => {
		const h = mount(BOLD, 'live', null);
		expect(h.handleKeydown(key('X'), at(11))).toBe(false);
	});

	// Relative to the construct, not to a direction: `Home` at a line-leading pair types before it.
	it('writes outside the construct for a line extreme, at either edge', () => {
		const lead = mount('**Lead** in\n', 'live', 'outside');
		expect(lead.handleKeydown(key('X'), at(2))).toBe(true);
		expect(lead.edits).toEqual([[0, 'X**Lead** in\n', 2, 1]]);

		const trailing = mount(BOLD, 'live', 'outside');
		expect(trailing.handleKeydown(key('X'), at(11))).toBe(true);
		expect(trailing.edits).toEqual([[0, 'Some **bold**X text\n', 11, 14]]);
	});
});

describe('a never-extend construct writes outside whatever the arrival', () => {
	const LINK = 'A [link](http://e.com) tail\n';

	it.each(['near', 'far', 'outside', null] as const)('arrival %s → past the closer', (affinity) => {
		const h = mount(LINK, 'live', affinity);
		expect(h.handleKeydown(key('X'), at(7))).toBe(true);
		expect(h.edits).toEqual([[0, 'A [link](http://e.com)X tail\n', 7, 23]]);
	});

	it('leaves the leading edge to native insertion, already outside the construct', () => {
		const h = mount(LINK, 'live', 'far');
		expect(h.handleKeydown(key('X'), at(2))).toBe(false);
	});
});

describe('the seat claims only a live caret typing at an edge', () => {
	// Source mode and the preview modes draw the delimiter, so the byte the user sees is the byte
	// they get and the browser's own insertion is already right.
	it.each([undefined, 'source', 'preview-block', 'preview-inline'])('declines in %s', (mode) => {
		const h = mount(BOLD, mode ?? 'source', 'far');
		expect(h.handleKeydown(key('X'), at(11))).toBe(false);
	});

	it('declines a chord, which is a command rather than a typed byte', () => {
		const h = mount(BOLD, 'live', 'far');
		for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
			expect(h.handleKeydown(key('X', mods), at(11))).toBe(false);
		}
	});

	// Backspace and Delete are absent on purpose: the same edge places a typed byte and cuts for
	// a destructive key, and the destructive branch owns those two
	// (`edge-policy-construct-delete.test.ts`).
	it('declines a non-printable key', () => {
		const h = mount(BOLD, 'live', 'far');
		for (const name of ['Enter', 'Tab', 'ArrowLeft']) {
			expect(h.handleKeydown(key(name), at(11))).toBe(false);
		}
	});

	it('declines in reading mode, which commits nothing', () => {
		const h = mount(BOLD, 'live', 'far', true);
		expect(h.handleKeydown(key('X'), at(11))).toBe(false);
		expect(h.edits).toHaveLength(0);
	});

	it('declines a null caret', () => {
		const h = mount(BOLD, 'live', 'far');
		expect(h.handleKeydown(key('X'), null)).toBe(false);
	});
});
