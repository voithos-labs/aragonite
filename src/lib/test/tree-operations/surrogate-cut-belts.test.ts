// @vitest-environment jsdom
// Every write that slices `raw` at a caret offset snaps to a scalar boundary first, or a gesture
// puts half a surrogate pair in each of two blocks.
// Miss-analysis: every offset these writes were driven with came from an ASCII fixture.
// Which modules may snap is G4.89's list, in `lint/file-rules.test.ts`.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { snapToScalarBoundary } from '#lib/core/lines.js';
import { splitNode } from '#lib/tree-operations/node-ops.js';
import { replaceRangeInLeaf } from '#lib/tree-operations/leaf-range.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import type { NodeView } from '#lib/core/node-views.js';
import { fixtureReading, topLevelStore } from '../harness/fixture-grammar';
import { isPlainSplice } from '../harness/plain-splice';

const BOY = 'a\u{1F466}b\n';

/** True when every surrogate in `text` has its partner. */
function isWellFormed(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const isHigh = code >= 0xd800 && code <= 0xdbff;
		const isLow = code >= 0xdc00 && code <= 0xdfff;
		if (isHigh && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
			i++;
			continue;
		}
		if (isHigh || isLow) return false;
	}
	return true;
}

describe('snapToScalarBoundary', () => {
	it('moves an interior offset back to the pair start and leaves every other alone', () => {
		expect(snapToScalarBoundary(BOY, 2)).toBe(1);
		for (const offset of [0, 1, 3, 4]) expect(snapToScalarBoundary(BOY, offset)).toBe(offset);
	});

	it('is identity where no pair is involved', () => {
		expect(snapToScalarBoundary('plain\n', 3)).toBe(3);
		// A lone high surrogate already in the bytes is not a pair to protect.
		expect(snapToScalarBoundary('a\uD83Db', 2)).toBe(2);
	});
});

describe('the split cut', () => {
	it('splits beside the pair, never through it', () => {
		const doc = parse(BOY);
		splitNode(doc, 0, 2, createSharingState(), fixtureReading());
		const out = serialize(doc);
		expect(isWellFormed(out)).toBe(true);
		expect(out).toBe('a\n\n\u{1F466}b\n');
	});
});

describe('the in-leaf range replace', () => {
	it('cuts to the pair boundary, leaving no half behind', () => {
		const node = parse(BOY).children[0] as NodeView;
		const edit = replaceRangeInLeaf(node, { start: 0, end: 2 }, '', topLevelStore(node));
		expect(isWellFormed(edit.raw)).toBe(true);
		expect(edit.raw).toBe('\u{1F466}b\n');
	});

	it('snaps the start endpoint too', () => {
		const node = parse(BOY).children[0] as NodeView;
		const edit = replaceRangeInLeaf(node, { start: 2, end: 4 }, '', topLevelStore(node));
		expect(isWellFormed(edit.raw)).toBe(true);
		expect(edit.raw).toBe('a\n');
	});

	it('snaps a mid-pair endpoint where nothing is cleaned, too', () => {
		const node = parse(BOY).children[0] as NodeView;
		const edit = replaceRangeInLeaf(node, { start: 2, end: 3 }, 'x', topLevelStore(node));
		expect(isWellFormed(edit.raw)).toBe(true);
		expect(edit.raw).toBe('axb\n');
	});
});

describe('the in-leaf range replace’s join', () => {
	// The pair sits inside `**…**`, so the delete strands the marker runs and the join cleanup
	// runs: the branch where a mid-pair endpoint reaches the slice.
	const SOURCE = 'Some **\u{1F466}bold** and *italic* words\n';

	it('snaps a mid-pair endpoint before slicing', () => {
		const node = parse(SOURCE, { scope: 'fragment' }).children[0] as NodeView;
		const store = topLevelStore(node, fixtureReading({}, 'live'));
		const edit = replaceRangeInLeaf(node, { start: 8, end: 22 }, '', store);
		expect(isPlainSplice(node, { start: 8, end: 22 }, '', edit)).toBe(false);
		expect(isWellFormed(edit.raw)).toBe(true);
	});
});
