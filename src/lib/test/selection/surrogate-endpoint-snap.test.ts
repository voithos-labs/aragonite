// @vitest-environment jsdom
//
// A UTF-16 offset can land inside a surrogate pair, and the public `setSelection` takes plain
// numbers, so the endpoint normalization is the only place that can refuse one. Miss-analysis:
// every generator feeding the endpoint normalizers draws pure ASCII, and the one suite that could
// have drawn this shape clamps the offset away before asserting, so no test had ever handed a
// normalizer an offset that splits a pair (#167).
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { rangeDelete } from '../../selection/range-delete';
import { normalizeCharEndpoint } from '../../selection/char-endpoint-snap';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';
import type { Document } from '../../core/nodes';
import { fixtureLinkRef } from '../harness/fixture-grammar';

/** 'a' + U+1F466 (a surrogate pair at offsets 1–2) + 'b'. */
const BOY = 'a\u{1F466}b\n\ntail\n';

/** Offsets holding a surrogate with no partner — bytes `TextEncoder` turns into U+FFFD. */
function loneSurrogatesIn(text: string): number[] {
	const at: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const isHigh = code >= 0xd800 && code <= 0xdbff;
		const isLow = code >= 0xdc00 && code <= 0xdfff;
		if (isHigh && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
			i++;
			continue;
		}
		if (isHigh || isLow) at.push(i);
	}
	return at;
}

function deleteAcross(doc: Document, startOffset: number, endOffset: number): string {
	const state = createSelectionState({ getDoc: () => doc });
	state.enterCrossBlock({ path: [0], offset: startOffset }, { path: [1], offset: endOffset });
	const { newDoc } = rangeDelete(
		doc,
		state.start!,
		state.end!,
		createSharingState(),
		undefined,
		undefined,
		fixtureLinkRef()
	);
	return serialize(newDoc);
}

describe('the one char-endpoint call refuses an offset inside a scalar', () => {
	it('snaps a mid-pair offset back to the pair start', () => {
		const doc = parse(BOY);
		expect(normalizeCharEndpoint(doc, { path: [0], offset: 2 }, [1])).toEqual({
			path: [0],
			offset: 1
		});
	});

	it('leaves every boundary offset alone', () => {
		const doc = parse(BOY);
		for (const offset of [0, 1, 3, 4]) {
			expect(normalizeCharEndpoint(doc, { path: [0], offset }, [1]).offset).toBe(offset);
		}
	});

	// The checker's own self-test: it must see the corruption it is meant to catch.
	it('the well-formedness check names a split pair and passes an intact one', () => {
		expect(loneSurrogatesIn('a\u{1F466}b')).toEqual([]);
		expect(loneSurrogatesIn('a\uD83D')).toEqual([1]);
		expect(loneSurrogatesIn('\uDC66b')).toEqual([0]);
	});
});

describe('a cross-block delete through a surrogate pair', () => {
	it('leaves the pair whole rather than half of it', () => {
		const out = deleteAcross(parse(BOY), 2, 2);
		expect(loneSurrogatesIn(out)).toEqual([]);
		// Snapping back to the pair start deletes it whole: the survivor is the plain prefix.
		expect(out).toBe('ail\n');
	});

	// The end endpoint's own case: the pair sits in the block the range finishes in.
	it('leaves the pair whole when the trailing endpoint splits it', () => {
		const out = deleteAcross(parse('head\n\na\u{1F466}b\n'), 2, 2);
		expect(loneSurrogatesIn(out)).toEqual([]);
		expect(out).toBe('he\u{1F466}b\n');
	});
});
