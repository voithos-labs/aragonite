import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import { constructContentRange } from '../../components/blocks/text/edge-seat';
import { resolveMarkedInsertion } from '../../components/blocks/text/pending-mark-insert';
import type { InlineMarkKind } from '../../cursor/pending-marks';
import { arbInlineSource, freshOrFixedSeed } from './arbitraries';

// A pending mark rewrites bytes the user never sees, so the only honest oracle is the parse of
// what it wrote: over every generated fixture, at every caret, for every mark subset, the toggle
// took exactly (or nothing was written), no delimiter became a visible star, and the original
// bytes survive. Re-derived from independent walks, so these can contradict the resolver's own
// check — they already did, catching a `_` pair killed by a splice that only ever writes `*`.
// Miss-analysis: the hand-written suite used single-WORD fixtures; a generator that reaches
// whitespace, nesting and non-markable seams is what turns "I probed it" into coverage.

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(707707) } as const;

const MARK_SUBSETS: InlineMarkKind[][] = [['strong'], ['emphasis'], ['strong', 'emphasis']];

/** What a reader sees: content with every delimiter dropped. Code-span content is verbatim, so
 *  a delimiter spliced inside one is just as visible as one in a text run. */
function visibleText(raw: string): string {
	let out = '';
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.children && node.children.length > 0) visit(node.children);
			else if (node.kind === 'inlineCode') out += node.text ?? '';
			else out += raw.slice(node.start, node.end);
		}
	};
	visit(parseInline(raw, 0, raw.length));
	return out;
}

/** Construct kinds whose CONTENT holds `offset` — the chain a toggle is resolved against. */
function chainAt(raw: string, offset: number): Set<string> {
	const kinds = new Set<string>();
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			const content = constructContentRange(node);
			if (!content || offset < content.start || offset > content.end) continue;
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

/** Code-point boundaries only: an offset inside a surrogate pair is not a caret. */
function caretPositions(text: string): number[] {
	const stops = [0];
	for (const char of text) stops.push(stops[stops.length - 1] + char.length);
	return stops;
}

function sorted(kinds: Iterable<string>): string[] {
	return [...kinds].sort();
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
					const stops = caretPositions(display);
					const caret = stops[caretPick % stops.length];
					const result = resolveMarkedInsertion(
						display,
						caret,
						'X',
						new Set(marks),
						parseInline(display, 0, display.length)
					);
					if (result === null) {
						declined++;
						return;
					}
					written++;

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

	it('no delimiter the rewrite touched becomes a visible star', () => {
		fc.assert(
			fc.property(
				arbInlineSource,
				fc.nat(),
				fc.constantFrom(...MARK_SUBSETS),
				(display, caretPick, marks) => {
					const stops = caretPositions(display);
					const caret = stops[caretPick % stops.length];
					const result = resolveMarkedInsertion(
						display,
						caret,
						'X',
						new Set(marks),
						parseInline(display, 0, display.length)
					);
					if (result === null) return;

					// Exactly one character appeared on screen, and it is the one that was typed.
					// Any delimiter that stopped being a delimiter would show up here as extra text.
					const before = visibleText(display);
					const after = visibleText(result.raw);
					expect(after.length, `visible text grew by more than the typed byte`).toBe(
						before.length + 1
					);
					expect(after.replace('X', ''), `visible text changed around the insertion`).toBe(before);
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
					const stops = caretPositions(display);
					const caret = stops[caretPick % stops.length];
					const result = resolveMarkedInsertion(
						display,
						caret,
						'X',
						new Set(marks),
						parseInline(display, 0, display.length)
					);
					if (result === null) return;

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

	it('the run exercised both answers', () => {
		expect(written, 'every case declined — the properties above proved nothing').toBeGreaterThan(0);
		expect(declined, 'no case declined — the fallback path is unexercised').toBeGreaterThan(0);
	});
});

function isSubsequence(needle: string, haystack: string): boolean {
	let i = 0;
	for (const char of haystack) {
		if (i < needle.length && haystack.slice(0) && needle.startsWith(char, i)) i += char.length;
		if (i >= needle.length) return true;
	}
	return i >= needle.length;
}
