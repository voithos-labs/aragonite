// @vitest-environment jsdom
// Where a block puts text typed at a hidden delimiter run: at the offset the policy and the side on
// record name, written by the step every insertion passes, since Chromium moves a collapsed caret
// back across a run it does not render.
// Miss-analysis: the policy entry and the arrival side shipped with no consumer to disagree with.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import type { CstNode } from '$lib/core/nodes';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { resolvedInlineContent } from '$lib/core/inline/inline-cache';
import { createTypedPlacement } from '$lib/components/blocks/text/edge-seat';
import { asPresentationMode } from '$lib/presentation-mode';
import { fixtureReading } from '../../harness/fixture-grammar';
import { installEdgeDispatchCleanup, mountSurface } from './edge-policy-fixture';

/** `node` drawn in `mode`, with `affinity` on record: its placement, and its displayed text. */
function placementOf(node: CstNode, mode: string, affinity: EdgeAffinity | null) {
	const display = trimTrailingLineEnding(node.raw);
	const reading = fixtureReading({}, asPresentationMode(mode));
	const placement = createTypedPlacement({
		getEl: () => el,
		getRaw: () => node.raw,
		getInlines: () => resolvedInlineContent(node, reading),
		reading,
		caretMemory: { side: () => affinity }
	});
	const el = mountSurface(display, mode);
	/** `typed` inserted at `at`, as the write passes it on: placed, or null where it stands. */
	const typedAt = (at: number, typed: string, side = affinity) =>
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

describe('a symmetric pair extends or not by the side on record', () => {
	it('leaves the near side where the browser put it', () => {
		expect(placementOf(block(BOLD), 'live', 'near').typedAt(11, 'X')).toBeNull();
	});

	it('writes past the closing run when the arrival came from the far side', () => {
		expect(placementOf(block(BOLD), 'live', 'far').typedAt(11, 'X')).toEqual({
			text: 'Some **bold**X text',
			caretAfter: 14
		});
	});

	it('writes inside the opening run when the arrival came from the far side', () => {
		expect(placementOf(block(BOLD), 'live', 'far').typedAt(5, 'X')).toEqual({
			text: 'Some **Xbold** text',
			caretAfter: 8
		});
	});

	// A click resets the arrival side, so the default is what a click means (live-mode.md § 4.2).
	it('leaves the byte with no side on record: a click keeps the construct’s near side', () => {
		expect(placementOf(block(BOLD), 'live', null).typedAt(11, 'X')).toBeNull();
	});

	// Relative to the construct, not to a direction: `Home` at a line-leading pair types before it.
	it('writes outside the construct for a line extreme, at either edge', () => {
		expect(placementOf(block('**Lead** in\n'), 'live', 'outside').typedAt(2, 'X')).toEqual({
			text: 'X**Lead** in',
			caretAfter: 1
		});
		expect(placementOf(block(BOLD), 'live', 'outside').typedAt(11, 'X')).toEqual({
			text: 'Some **bold**X text',
			caretAfter: 14
		});
	});
});

describe('a never-extend construct takes the byte outside whatever the arrival', () => {
	const LINK = 'A [link](http://e.com) tail\n';

	it.each(['near', 'far', 'outside', null] as const)('arrival %s → past the closer', (affinity) => {
		expect(placementOf(block(LINK), 'live', affinity).typedAt(7, 'X')).toEqual({
			text: 'A [link](http://e.com)X tail',
			caretAfter: 23
		});
	});

	it('leaves the leading edge alone, already outside the construct', () => {
		expect(placementOf(block(LINK), 'live', 'far').typedAt(2, 'X')).toBeNull();
	});
});

describe('only a screen that hides the markers moves a byte', () => {
	// Source mode and the preview modes draw the delimiter, so the byte the user sees is the byte
	// they get and the browser's own insertion is already right.
	it.each(['source', 'preview-block', 'preview-inline'])('leaves it where it is in %s', (mode) => {
		expect(placementOf(block(BOLD), mode, 'far').typedAt(11, 'X')).toBeNull();
	});
});

// The auto-pair asks where a delimiter lands before deciding what it writes there, or one placed
// past the closer would arrive without its partner.
describe('where a delimiter typed at a hidden run lands', () => {
	it('past the closer, in a paragraph', () => {
		expect(placementOf(block(BOLD), 'live', 'far').placement.offsetFor(11, '`')).toBe(13);
	});

	// Miss-analysis: every case at a hidden run typed in a paragraph, so none met a cell's bytes,
	// which carry no line ending.
	it('past the closer, in a table cell', () => {
		const doc = parse('| h |\n| - |\n| Some **bold** text |\n');
		const cell = nodeAt(doc, [0, 1, 0]) as CstNode;
		expect(placementOf(cell, 'live', 'far').placement.offsetFor(11, '`')).toBe(13);
	});

	it('at the caret where the markers are drawn', () => {
		expect(placementOf(block(BOLD), 'source', 'far').placement.offsetFor(11, '`')).toBe(11);
	});
});
