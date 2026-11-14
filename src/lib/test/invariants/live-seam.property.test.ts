// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { displayLength, snapToScalarBoundary } from '#lib/core/lines.js';
import { getContentRange, isProseKind, parseInline } from '#lib/core/inline/index.js';
import { CONTENT_VISIBILITY, renderedText } from '#lib/core/inline/visibility.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { markedChars, marksWithin, type MarkedChar } from '#lib/test/harness/live-oracles.js';
import { unpaintedResidue } from '#lib/test/simulation/live-screen-reading.js';
import { arbInlineSource, freshOrFixedSeed } from './arbitraries';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading, renderOptions } from '../harness/fixture-grammar';
import { deleteRange } from '../harness/range-delete';

/**
 * The join of live-mode.md § 4.5 under random range deletes, compared with the literal join for
 * reload shape, round-trip and § 4.1's leftovers; what shows on screen is the unit suite's job.
 */

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(515151) } as const;

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

/** The drawn cut, ordered and clamped to each block's content, so the endpoints are ones a
 *  selection can produce and land inside constructs; null when there is nothing to cut. */
function endpointsIn(doc: Document, cut: Cut): { start: number[]; end: number[] } | null {
	const count = doc.children.length;
	if (count === 0) return null;
	const lo = Math.min(cut.startBlock % count, cut.endBlock % count);
	const hi = Math.max(cut.startBlock % count, cut.endBlock % count);
	// The joins under test are prose's: a drawn fence line hides its syntax, which no live caret reaches.
	if (doc.children.slice(lo, hi + 1).some((node) => !isProseKind(node.kind))) return null;
	// A selection never parts a surrogate pair.
	const clamp = (block: number, offset: number): number => {
		const range = getContentRange(doc.children[block]);
		const at = range.start + (offset % Math.max(1, range.end - range.start + 1));
		return snapToScalarBoundary(doc.children[block].raw, at);
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
	residue: number;
	marked: MarkedChar[];
	/** The characters of the document before the delete that the range left standing. */
	kept: MarkedChar[];
}

function deleteAcross(
	source: string,
	cut: Cut,
	mode: PresentationMode | undefined
): DeleteResult | null {
	const doc = parse(source);
	const points = endpointsIn(doc, cut);
	if (!points) return null;
	const [lo, a] = points.start;
	const [hi, b] = points.end;
	const kept = markedChars(doc.children.map(contentOf)).filter(
		({ block, at }) =>
			block < lo || block > hi || (block === lo && at < a) || (block === hi && at >= b)
	);
	deleteRange(
		doc,
		{ path: points.start.slice(0, 1), offset: points.start[1] },
		{ path: points.end.slice(0, 1), offset: points.end[1] },
		{ reading: fixtureReading({}, mode) }
	);
	const bytes = serialize(doc);
	return {
		bytes,
		shape: describeConvergence(doc),
		visible: doc.children.map(visibleTextOf).join('\n'),
		residue: unpaintedResidue(doc),
		marked: markedChars(doc.children.map(contentOf)),
		kept
	};
}

const contentOf = (node: Document['children'][number]) => ({
	raw: node.raw,
	content: getContentRange(node)
});

/** How the characters a delete shows compare with the ones it kept: each in the same marks, some
 *  in fewer (a fallback that dropped a run it could not close), or anything else. */
function compareMarks(
	shown: readonly MarkedChar[],
	kept: readonly MarkedChar[]
): 'same' | 'fewer' | 'other' {
	if (shown.length !== kept.length || shown.some((c, i) => c.char !== kept[i].char)) return 'other';
	if (shown.every((c, i) => c.marks === kept[i].marks)) return 'same';
	return shown.every((c, i) => marksWithin(c.marks, kept[i].marks)) ? 'fewer' : 'other';
}

const describeMarks = (chars: readonly MarkedChar[]): string =>
	chars.map(({ char, marks }) => (marks === '' ? char : `${char}[${marks}]`)).join('');

function visibleTextOf(node: Document['children'][number]): string {
	const range = getContentRange(node);
	if (range.end > displayLength(node.raw)) return node.raw;
	return renderedText(
		parseInline(node.raw, range.start, range.end),
		node.raw,
		CONTENT_VISIBILITY,
		renderOptions()
	);
}

describe('live-mode joins over random range deletes', () => {
	// Miss-analysis: only a reading that keeps the runs was read back for marks, and the fixed
	// seed drew no drop that left a later run to re-pair over kept text.
	it('a delete that drops a run never marks a character it kept', () => {
		const source = '``code``*a **b* c**foo**foo**[text](url)\n';
		const cut = { startBlock: 0, startOffset: 9, endBlock: 0, endOffset: 16 };
		const live = deleteAcross(source, cut, 'live')!;
		const literal = deleteAcross(source, cut, undefined)!;
		const marks = live.bytes === literal.bytes ? 'literal' : compareMarks(live.marked, live.kept);
		expect(marks, live.bytes).not.toBe('other');
	});

	// G1.91. The counters prove the draws reach the rewrite and that it takes glyphs off the
	// screen; a comparison over draws that never rewrite proves nothing about the rewrite.
	it('a live delete keeps every kept character and its marks, adds no residue, and diverges only where the literal one does', () => {
		let rewritten = 0;
		let cleaned = 0;
		let same = 0;
		let fewer = 0;
		const glyphs = (text: string) => (text.match(/[*_~`[\]]/g) ?? []).length;
		fc.assert(
			fc.property(arbInlineDoc, arbCut, (source, cut) => {
				const literal = deleteAcross(source, cut, undefined);
				const live = deleteAcross(source, cut, 'live');
				if (literal === null || live === null) return;
				if (live.bytes !== literal.bytes) rewritten++;
				if (glyphs(live.visible) < glyphs(literal.visible)) cleaned++;

				// Where live mode rewrote the join, the reader sees the characters the range left,
				// each in the marks it had; where it wrote the literal join, the markers show instead.
				const marks =
					live.bytes === literal.bytes ? 'literal' : compareMarks(live.marked, live.kept);
				if (marks === 'same') same++;
				if (marks === 'fewer') fewer++;
				if (marks === 'other') {
					throw new Error(
						`${JSON.stringify(source)}: live wrote ${JSON.stringify(live.bytes)}, showing ` +
							`${describeMarks(live.marked)} for ${describeMarks(live.kept)}`
					);
				}
				// Neither baseline alone: the literal cut can swallow leftovers the document already
				// carried or add its own, so live mode answers only for what exceeds both.
				if (live.residue > Math.max(unpaintedResidue(parse(source)), literal.residue)) {
					throw new Error(
						`${JSON.stringify(source)}: live mode left residue in ${JSON.stringify(live.bytes)} ` +
							`against ${JSON.stringify(literal.bytes)}`
					);
				}

				if (literal.shape !== null || serialize(parse(literal.bytes)) !== literal.bytes) return;
				if (live.shape !== null) {
					throw new Error(`${JSON.stringify(source)}: reload shape; ${live.shape}`);
				}
				if (serialize(parse(live.bytes)) !== live.bytes) {
					throw new Error(
						`${JSON.stringify(source)}: not a round-trip ${JSON.stringify(live.bytes)}`
					);
				}
			}),
			PARAMS
		);
		expect(rewritten).toBeGreaterThan(20);
		expect(cleaned).toBeGreaterThan(10);
		// A run whose closer would butt against a run of its own delimiter has no spelling, so a few
		// deletes fall back to dropping it; the rest keep every mark.
		expect(same).toBeGreaterThan(80);
		expect(fewer).toBeLessThan(rewritten / 8);
	}, 30_000);
});
