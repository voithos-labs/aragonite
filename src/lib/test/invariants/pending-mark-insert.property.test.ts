// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import { constructContentRange } from '../../core/inline';
import {
	resolveMarkedInsertion,
	type MarkedInsertion
} from '../../components/blocks/text/pending-mark-insert';
import type { InlineMarkKind } from '../../schema/inline-construct-policy';
import { isSubsequence } from '$lib/test/harness/live-oracles';
import { caretPositions, countOnScreen, paintedText } from '$lib/test/harness/painted-text';
import { arbInlineSource, freshOrFixedSeed } from './arbitraries';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

// A pending mark rewrites bytes the user never sees, so the render path is the check: at every
// caret the toggle took exactly or wrote nothing, only the typed letter painted, no byte was lost.

// Miss-analysis: single-word fixtures and a check copied from the resolver shared its blind spots.

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(707707) } as const;

const MARK_SUBSETS: InlineMarkKind[][] = [
	['strong'],
	['emphasis'],
	['strikethrough'],
	['inlineCode'],
	['strong', 'emphasis'],
	['strikethrough', 'inlineCode']
];

/** Every marker byte any kind can paint, not just the two this resolver writes: a `_` pair it
 *  kills shows up the same way. */
const DELIMITERS = '*_~`<>';

/** The chain a toggle resolves against: a construct with children includes its own edges, where
 *  typing extends it, and a childless one does not, so its edges are ordinary insertion points. */
function chainAt(raw: string, offset: number): Set<string> {
	const kinds = new Set<string>();
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.kind === 'text') continue;
			const content = constructContentRange(node);
			if (content) {
				if (offset < content.start || offset > content.end) continue;
			} else if (offset <= node.start || offset >= node.end) continue;
			kinds.add(node.kind);
			if (node.children) visit(node.children);
		}
	};
	visit(parseInline(raw, 0, raw.length));
	return kinds;
}

/** Construct kinds covering `[start, end)` in the rewritten bytes. */
function kindsCovering(raw: string, start: number, end: number): Set<string> {
	const kinds = new Set<string>();
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.start > start || end > node.end) continue;
			if (node.kind !== 'text') kinds.add(node.kind);
			if (node.children) visit(node.children);
		}
	};
	visit(parseInline(raw, 0, raw.length));
	return kinds;
}

/** Every construct kind in the block, by a flat count sharing no code with the resolver or the
 *  render path, since a rewrite can satisfy both and still have eaten a construct elsewhere. */
function kindsPresent(raw: string): Set<string> {
	const kinds = new Set<string>();
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.kind !== 'text') kinds.add(node.kind);
			if (node.children) visit(node.children);
		}
	};
	visit(parseInline(raw, 0, raw.length));
	return kinds;
}

function sorted(kinds: Iterable<string>): string[] {
	return [...kinds].sort();
}

/** The caret a draw picks, and what the resolver answered there; `null` where it declined. */
function resolveDraw(
	display: string,
	caretPick: number,
	marks: InlineMarkKind[]
): { caret: number; result: MarkedInsertion } | null {
	const stops = caretPositions(display);
	const caret = stops[caretPick % stops.length];
	const result = resolveMarkedInsertion(
		display,
		caret,
		'X',
		new Set(marks),
		parseInline(display, 0, display.length),
		fixtureReading()
	);
	return result === null ? null : { caret, result };
}

describe('pending-mark insertion over generated formatted fixtures', () => {
	// Declining is a legal answer (markdown cannot express every combination at every caret), so
	// the run is only meaningful if both answers actually occur.
	let written = 0;
	let declined = 0;

	it('either the toggle took exactly, or nothing was written', () => {
		fc.assert(
			fc.property(
				arbInlineSource,
				fc.nat(),
				fc.constantFrom(...MARK_SUBSETS),
				(display, caretPick, marks) => {
					const hit = resolveDraw(display, caretPick, marks);
					if (hit === null) {
						declined++;
						return;
					}
					written++;
					const { caret, result } = hit;

					// The toggle's own definition: a kind the chain carried is gone, a kind it
					// lacked is there, and every construct the caret was inside otherwise survives.
					const before = chainAt(display, caret);
					const intended = new Set<string>(
						[...before].filter((kind) => !(marks as string[]).includes(kind))
					);
					for (const mark of marks) if (!before.has(mark)) intended.add(mark);

					const around = kindsCovering(result.raw, result.caret - 1, result.caret);
					expect(
						sorted(around),
						`chain around the insertion in ${JSON.stringify(result.raw)}`
					).toEqual(sorted(intended));
				}
			),
			PARAMS
		);
	});

	it('the painted text gains only the typed character, and no delimiter with it', () => {
		fc.assert(
			fc.property(
				arbInlineSource,
				fc.nat(),
				fc.constantFrom(...MARK_SUBSETS),
				(display, caretPick, marks) => {
					const hit = resolveDraw(display, caretPick, marks);
					if (hit === null) return;
					const { result } = hit;

					// Exactly one character appeared on screen, and it is the one that was typed. A
					// delimiter that stopped being a delimiter shows up here as extra painted text.
					const before = paintedText(display);
					const after = paintedText(result.raw);
					expect(after.length, `painted text grew by more than the typed byte`).toBe(
						before.length + 1
					);
					expect(after.replace('X', ''), `painted text changed around the insertion`).toBe(before);
					// Independent of the equality above: a rewrite may never put a delimiter on screen
					// that was not already there, whichever kind painted it.
					expect(
						countOnScreen(result.raw, DELIMITERS),
						`a delimiter surfaced in ${JSON.stringify(result.raw)}`
					).toBe(countOnScreen(display, DELIMITERS));
				}
			),
			PARAMS
		);
	});

	it('the original bytes survive and the caret sits just past what was typed', () => {
		fc.assert(
			fc.property(
				arbInlineSource,
				fc.nat(),
				fc.constantFrom(...MARK_SUBSETS),
				(display, caretPick, marks) => {
					const hit = resolveDraw(display, caretPick, marks);
					if (hit === null) return;
					const { result } = hit;

					// A rewrite only splices: every original byte is still there, in order.
					expect(isSubsequence(display, result.raw), `${JSON.stringify(display)} was cut`).toBe(
						true
					);
					expect(result.raw.slice(result.caret - 1, result.caret)).toBe('X');
					expect(result.caret).toBeLessThanOrEqual(result.raw.length);
				}
			),
			PARAMS
		);
	});

	it('no construct kind vanishes from the block', () => {
		fc.assert(
			fc.property(
				arbInlineSource,
				fc.nat(),
				fc.constantFrom(...MARK_SUBSETS),
				(display, caretPick, marks) => {
					const hit = resolveDraw(display, caretPick, marks);
					if (hit === null) return;
					const { result } = hit;

					// A rewrite splits and reopens constructs; it never spends one. A kind that was in
					// the block and is not in it afterwards was destroyed by the splice.
					const after = kindsPresent(result.raw);
					const lost = [...kindsPresent(display)].filter((kind) => !after.has(kind));
					expect(lost, `${JSON.stringify(display)} → ${JSON.stringify(result.raw)}`).toEqual([]);
				}
			),
			PARAMS
		);
	});

	it('the run exercised both answers', () => {
		expect(written, 'every case declined: the properties above proved nothing').toBeGreaterThan(0);
		expect(declined, 'no case declined: the fallback path is unexercised').toBeGreaterThan(0);
	});
});
