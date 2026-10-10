// @vitest-environment jsdom
// Where a block puts text typed at a hidden delimiter run: at the offset the edge rule and the
// record on the caret memory name, written by the step every insertion passes, since Chromium
// moves a collapsed caret back across a run it does not render.
// Miss-analysis: the policy entry and the arrival side shipped with no consumer to disagree with.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import type { EdgeAffinity } from '#lib/caret/edge-affinity.js';
import type { CstNode } from '#lib/core/nodes.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { createTypedPlacement } from '#lib/components/blocks/text/edge-seat.js';
import { asPresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '../../harness/fixture-grammar';
import { installEdgeDispatchCleanup, mountSurface } from './edge-policy-fixture';

/** `node` drawn in `mode`, with `record` on the caret memory: its placement, and its displayed text. */
function placementOf(node: CstNode, mode: string, record: EdgeAffinity | null) {
	const display = trimTrailingLineEnding(node.raw);
	const reading = fixtureReading({}, asPresentationMode(mode));
	const placement = createTypedPlacement({
		getEl: () => el,
		getNode: () => node,
		reading,
		caretMemory: { side: () => record, noteOutside: () => {} },
		heldSpace: () => ({ at: () => null, inside: () => null, passCloser: () => false })
	});
	const el = mountSurface(display, mode);
	/** `typed` inserted at `at`, as the write passes it on: placed, or null where it stands. */
	const typedAt = (at: number, typed: string, side = record) =>
		placement.insertion(
			display,
			{ text: display.slice(0, at) + typed + display.slice(at), caretAfter: at + typed.length },
			at,
			side
		);
	return { placement, typedAt };
}

const block = (source: string) => parse(source).children[0];

installEdgeDispatchCleanup();

const BOLD = 'Some **bold** text\n';

describe('a mark takes the byte by the character before it', () => {
	it('leaves a byte the browser put inside where it is', () => {
		expect(placementOf(block(BOLD), 'live', null).typedAt(11, 'X')).toBeNull();
	});

	it('moves a byte the browser put past the closing run back inside', () => {
		expect(placementOf(block(BOLD), 'live', null).typedAt(13, 'X')).toEqual({
			text: 'Some **boldX** text',
			caretAfter: 12,
			crossed: ['strong']
		});
	});

	it('writes a byte at a line start inside the construct that opens it', () => {
		expect(placementOf(block('**Lead** in\n'), 'live', null).typedAt(0, 'X')).toEqual({
			text: '**XLead** in',
			caretAfter: 3,
			crossed: ['strong']
		});
	});

	// A fresh start or a typed closer: outside, at either edge.
	it('writes outside the construct with the outside record, at either edge', () => {
		expect(placementOf(block('**Lead** in\n'), 'live', 'outside').typedAt(2, 'X')).toEqual({
			text: 'X**Lead** in',
			caretAfter: 1,
			crossed: ['strong']
		});
		expect(placementOf(block(BOLD), 'live', 'outside').typedAt(11, 'X')).toEqual({
			text: 'Some **bold**X text',
			caretAfter: 14,
			crossed: ['strong']
		});
	});
});

describe('a never-extend construct takes the byte outside, with or without a record', () => {
	const LINK = 'A [link](http://e.com) tail\n';

	it.each(['outside', null] as const)('record %s → past the closer', (record) => {
		expect(placementOf(block(LINK), 'live', record).typedAt(7, 'X')).toEqual({
			text: 'A [link](http://e.com)X tail',
			caretAfter: 23,
			crossed: ['link']
		});
	});

	it('leaves the leading edge alone, already outside the construct', () => {
		expect(placementOf(block(LINK), 'live', null).typedAt(2, 'X')).toBeNull();
	});
});

describe('only a screen that hides the markers moves a byte', () => {
	// Source mode and the preview modes draw the delimiter, so the byte the user sees is the byte
	// they get and the browser's own insertion is already right.
	it.each(['source', 'preview-block', 'preview-inline'])('leaves it where it is in %s', (mode) => {
		expect(placementOf(block(BOLD), mode, 'outside').typedAt(11, 'X')).toBeNull();
	});
});

// The auto-pair asks where a delimiter lands before deciding what it writes there, or one placed
// past the closer would arrive without its partner.
describe('where a delimiter typed at a hidden run lands', () => {
	it('past the closer, in a paragraph', () => {
		expect(placementOf(block(BOLD), 'live', 'outside').placement.offsetFor(11, '`')).toBe(13);
	});

	// Miss-analysis: every case at a hidden run typed in a paragraph, so none met a cell's bytes,
	// which carry no line ending.
	it('past the closer, in a table cell', () => {
		const doc = parse('| h |\n| - |\n| Some **bold** text |\n');
		const cell = nodeAt(doc, [0, 1, 0]) as CstNode;
		expect(placementOf(cell, 'live', 'outside').placement.offsetFor(11, '`')).toBe(13);
	});

	it('at the caret where the markers are drawn', () => {
		expect(placementOf(block(BOLD), 'source', 'outside').placement.offsetFor(11, '`')).toBe(11);
	});

	// The closer the caret is beside types over itself, from either raw offset of the edge.
	it.each([11, 13])('a closer byte types over the hidden closer, from %i', (caret) => {
		expect(placementOf(block(BOLD), 'live', null).placement.offsetFor(caret, '*')).toBe(11);
	});
});

// After a split the caret reads the reopened run's start, raw 0, while Chromium types past the run.
// Miss-analysis: every placement row put the text where the caret read, so none saw the two differ.
describe('a caret read across a hidden run from where the text went', () => {
	const REOPENED = block('**ld** text\n');
	const typedPastOpener = { text: '**Xld** text', caretAfter: 3 };

	it('places the text from the caret’s own offset when it names the same position', () => {
		const { placement } = placementOf(REOPENED, 'live', 'outside');
		expect(placement.insertion('**ld** text', typedPastOpener, 2, 'outside', 0)).toEqual({
			text: 'X**ld** text',
			caretAfter: 1,
			crossed: ['strong']
		});
	});

	it('ignores a caret at another screen position', () => {
		const { placement } = placementOf(REOPENED, 'live', 'outside');
		expect(placement.insertion('**ld** text', typedPastOpener, 2, 'outside', 9)).toEqual({
			text: 'X**ld** text',
			caretAfter: 1,
			crossed: ['strong']
		});
	});
});
