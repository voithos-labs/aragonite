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

// A pending mark rewrites bytes the user never sees, so the only honest oracle is what the RENDER
// PATH does with them: at every caret, for every mark subset, the toggle took exactly (or nothing
// was written), the painted text gained only the typed character with no delimiter beside it, and
// the original bytes survive.

// Miss-analysis, twice: single-WORD fixtures missed every shape needing whitespace, nesting or a
// non-markable seam; then this file's own oracle was a walk copied from the resolver's, blind in
// the same place (an autolink's `<`/`>` read as content), so a shape that killed the link passed
// both. Asking the painter is what closes it — see `paintedText`.

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(707707) } as const;

const MARK_SUBSETS: InlineMarkKind[][] = [
	['strong'],
	['emphasis'],
	['strikethrough'],
	['inlineCode'],
	['strong', 'emphasis'],
	['strikethrough', 'inlineCode']
];

/** Every marker byte any kind can paint, not just the two this resolver writes — a `_` pair it
 *  kills surfaces the same way. */
const DELIMITERS = '*_~`<>';

/**
 * The chain a toggle is resolved against, from the spec's two containment rules: a construct with
 * children is content-INCLUSIVE (its edges are where continued typing extends it), a childless one
 * is STRICT-interior (its edges are ordinary insertion points).
 */
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

/**
 * Every construct kind anywhere in the block. A flat census, sharing ZERO code with the resolver:
 * not its chain walk, not the render path its own check reads. That independence is the point — a
 * rewrite can satisfy both of those and still have eaten a construct somewhere else.
 */
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
		parseInline(display, 0, display.length)
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
		expect(written, 'every case declined — the properties above proved nothing').toBeGreaterThan(0);
		expect(declined, 'no case declined — the fallback path is unexercised').toBeGreaterThan(0);
	});
});
