// @vitest-environment jsdom
// Where the caret-edge dispatch puts a byte typed at a hidden delimiter run: through the CST, at
// the offset the policy and the arrival side name, since Chromium moves a collapsed caret back
// across a run it does not render.
// Miss-analysis: the policy entry and the arrival side shipped with no consumer to disagree with.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import type { CstNode } from '$lib/core/nodes';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { fixtureReading } from '../../harness/fixture-grammar';
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

	// A delimiter still gets the auto-pair's bytes, or one placed past the closer lacks its partner.
	// Miss-analysis: every case typed a letter, so no delimiter met the auto-pair keydown pre-empts.
	it('writes a delimiter’s paired closer at the caret position, not a lone byte', () => {
		const h = mount(BOLD, 'live', 'far');
		expect(h.handleKeydown(key('`'), at(11))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bold**`` text\n', 11, 14]]);
	});

	// Miss-analysis: every case at a hidden run typed in a paragraph, so none met the kind check a
	// cell's text fails the moment it is read as a block.
	it('pairs a delimiter at a seat in a table cell, as in a paragraph', () => {
		const doc = parse('| h |\n| - |\n| Some **bold** text |\n');
		const path = [0, 1, 0];
		const cell = nodeAt(doc, path) as CstNode;
		const el = mountSurface(cell.raw, 'live');
		const h = makeEdgeDispatch(cell, el, {
			getEdgeAffinity: () => 'far',
			storedAs: () => storedAsAt(doc, path, fixtureReading({}, 'live'))
		});
		expect(h.handleKeydown(key('`'), at(11))).toBe(true);
		expect(h.edits).toEqual([[0, 'Some **bold**`` text\n', 11, 14]]);
	});

	// A click resets the arrival side, so the default is what a click means (live-mode.md § 4.2).
	it('declines with no arrival on record: a click keeps the construct’s near side', () => {
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

describe('the caret position claims only a live caret typing at an edge', () => {
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

	// Backspace and Delete are absent on purpose: the destructive branch owns them
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
