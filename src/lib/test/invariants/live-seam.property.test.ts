// @vitest-environment jsdom
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { displayLength } from '$lib/core/lines';
import { getContentRange, parseInline } from '$lib/core/inline';
import { renderedText } from '$lib/core/inline-render';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { arbInlineSource, freshOrFixedSeed } from './arbitraries';
import type { PresentationMode } from '$lib/presentation-mode';

/**
 * § 4.5's join seam under random range deletes. DIFFERENTIAL like the split arm: the seam sits on
 * a range delete with divergences of its own. It sees reload shape, round-trip, empty pairs, and
 * that the rewrite only ever REMOVES bytes from the join it was handed. It does not see a
 * delimiter surfacing — measured: the literal join can re-form a construct ACROSS the seam and
 * hide glyphs the two sides showed apart, so it is no upper bound. That claim belongs to the
 * cleanup's own render-path oracle, the unit suite and the e2e rows.
 */

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(515151) } as const;

/**
 * The residue § 4.4 names: a symmetric emphasis pair with nothing between it. Two shapes are
 * deliberately NOT counted, both measured: `[]()`, because a link emptied of its text is
 * `autoUnwrapOnEmpty`'s business and the literal join reaches it just as often spelt `[**]()`;
 * and a backtick run, because the two arms spell the same residue at different lengths
 * (``` ``` ``` against `` `` ``) and the count would report the shorter one as the offender.
 */
const EMPTY_PAIR = /\*\*\*\*|~~~~|(?<![\w_])____(?![\w_])/g;

interface Cut {
	startBlock: number;
	startOffset: number;
	endBlock: number;
	endOffset: number;
}

const arbCut: fc.Arbitrary<Cut> = fc.record({
	startBlock: fc.nat({ max: 3 }),
	startOffset: fc.nat({ max: 60 }),
	endBlock: fc.nat({ max: 3 }),
	endOffset: fc.nat({ max: 60 })
});

const arbInlineDoc = fc
	.array(arbInlineSource, { minLength: 1, maxLength: 3 })
	.map((paragraphs) => paragraphs.join('\n\n') + '\n');

/** The drawn cut wrapped into the document, ordered, and clamped to each block's CONTENT — the
 *  endpoints a selection can actually produce, so the draws land inside constructs rather than
 *  past them. Null when the document has nothing to cut. */
function endpointsIn(doc: Document, cut: Cut): { start: number[]; end: number[] } | null {
	const count = doc.children.length;
	if (count === 0) return null;
	const lo = Math.min(cut.startBlock % count, cut.endBlock % count);
	const hi = Math.max(cut.startBlock % count, cut.endBlock % count);
	const clamp = (block: number, offset: number): number => {
		const range = getContentRange(doc.children[block]);
		return range.start + (offset % Math.max(1, range.end - range.start + 1));
	};
	const a = clamp(lo, cut.startOffset);
	const b = clamp(hi, cut.endOffset);
	if (lo === hi && a === b) return null;
	return lo === hi && a > b ? { start: [lo, b], end: [hi, a] } : { start: [lo, a], end: [hi, b] };
}

interface DeleteResult {
	bytes: string;
	shape: string | null;
	visible: string;
	emptyPairs: number;
}

function deleteRange(
	source: string,
	cut: Cut,
	mode: PresentationMode | undefined
): DeleteResult | null {
	const doc = parse(source);
	const points = endpointsIn(doc, cut);
	if (!points) return null;
	rangeDelete(
		doc,
		{ path: points.start.slice(0, 1), offset: points.start[1] },
		{ path: points.end.slice(0, 1), offset: points.end[1] },
		createSharingState(),
		undefined,
		mode
	);
	const bytes = serialize(doc);
	return {
		bytes,
		shape: describeConvergence(doc),
		visible: doc.children.map(visibleTextOf).join('\n'),
		emptyPairs: (bytes.match(EMPTY_PAIR) ?? []).length
	};
}

function visibleTextOf(node: Document['children'][number]): string {
	const range = getContentRange(node);
	if (range.end > displayLength(node.raw)) return node.raw;
	return renderedText(parseInline(node.raw, range.start, range.end), node.raw);
}

/** Whether `inner` can be read off `outer` by deleting characters — the shape of a rewrite that
 *  only ever drops runs from the bytes it was handed. Code UNITS, not code points: an offset is a
 *  code-unit index everywhere in the editor, so a lone surrogate is a byte like any other here. */
function isSubsequence(inner: string, outer: string): boolean {
	let at = 0;
	for (let i = 0; i < outer.length; i++) {
		if (at < inner.length && inner.charCodeAt(at) === outer.charCodeAt(i)) at++;
	}
	return at === inner.length;
}

describe('live-mode join seams over random range deletes', () => {
	beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
	afterAll(() => __resetLiveJoinSeamCleanerForTests());

	it('a live delete diverges nowhere the byte-literal delete already does', () => {
		fc.assert(
			fc.property(arbInlineDoc, arbCut, (source, cut) => {
				const literal = deleteRange(source, cut, undefined);
				if (literal === null || literal.shape !== null) return;
				if (serialize(parse(literal.bytes)) !== literal.bytes) return;
				const live = deleteRange(source, cut, 'live');
				if (live === null) return;
				if (live.shape !== null) {
					throw new Error(`${JSON.stringify(source)}: reload shape — ${live.shape}`);
				}
				if (serialize(parse(live.bytes)) !== live.bytes) {
					throw new Error(
						`${JSON.stringify(source)}: not a round-trip ${JSON.stringify(live.bytes)}`
					);
				}
			}),
			PARAMS
		);
	});

	it('a live delete only ever drops bytes, and never mints an empty pair', () => {
		fc.assert(
			fc.property(arbInlineDoc, arbCut, (source, cut) => {
				const literal = deleteRange(source, cut, undefined);
				const live = deleteRange(source, cut, 'live');
				if (literal === null || live === null) return;
				if (!isSubsequence(live.bytes, literal.bytes)) {
					throw new Error(
						`${JSON.stringify(source)}: live wrote ${JSON.stringify(live.bytes)}, not a ` +
							`subsequence of ${JSON.stringify(literal.bytes)}`
					);
				}
				if (live.emptyPairs > literal.emptyPairs) {
					throw new Error(
						`${JSON.stringify(source)}: live minted an empty pair in ${JSON.stringify(live.bytes)} ` +
							`against ${JSON.stringify(literal.bytes)}`
					);
				}
			}),
			PARAMS
		);
	});

	// Non-vacuity: a differential property over draws that never rewrite proves nothing about the
	// rewrite, and a glyph budget nobody spends is a guard that guards nothing.
	it('the corpus reaches the rewrite, and the rewrite takes glyphs off the screen', () => {
		let rewritten = 0;
		let cleaned = 0;
		const glyphs = (text: string) => (text.match(/[*_~`[\]]/g) ?? []).length;
		fc.assert(
			fc.property(arbInlineDoc, arbCut, (source, cut) => {
				const literal = deleteRange(source, cut, undefined);
				const live = deleteRange(source, cut, 'live');
				if (literal === null || live === null) return;
				if (live.bytes !== literal.bytes) rewritten++;
				if (glyphs(live.visible) < glyphs(literal.visible)) cleaned++;
			}),
			PARAMS
		);
		expect(rewritten).toBeGreaterThan(20);
		expect(cleaned).toBeGreaterThan(10);
	});
});
