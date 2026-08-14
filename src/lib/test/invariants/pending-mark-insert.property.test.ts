// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { MARKER_FAMILY_SELECTOR } from '../../core/inline/visibility';
import { constructContentRange } from '../../core/inline';
import { resolveMarkedInsertion } from '../../components/blocks/text/pending-mark-insert';
import type { InlineMarkKind } from '../../cursor/pending-marks';
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

/**
 * The DOM the block actually paints, read text node by text node with marker subtrees skipped.
 * Deliberately NOT `renderedText`, which the resolver's own check calls: sharing the PAINTER is
 * the point, sharing the traversal would make this echo the check instead of contesting it. The
 * FAMILIES are the model's, though — a private list of them went stale on the ref label once.
 */
function paintedText(raw: string): string {
	const fragment = renderInlineNodes(parseInline(raw, 0, raw.length), raw);
	const host = document.createElement('div');
	host.appendChild(fragment);
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	let out = '';
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (!node.parentElement?.closest(MARKER_FAMILY_SELECTOR)) out += node.textContent ?? '';
	}
	return out;
}

/** Delimiter bytes left on screen once the marker spans are gone. Every marker byte any kind can
 *  paint, not just the two this resolver writes — a `_` pair it kills surfaces the same way. */
function delimitersOnScreen(raw: string): number {
	let count = 0;
	for (const char of paintedText(raw)) if ('*_~`<>'.includes(char)) count++;
	return count;
}

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

/** Code-point boundaries only, for the ORACLE's sake rather than the caret's: this net judges
 *  painted text and construct kinds, neither of which can see a slice through a scalar, so a
 *  mid-pair stop would pass here. The gesture fuzzer's well-formedness oracle owns that class. */
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

	it('the painted text gains only the typed character, and no delimiter with it', () => {
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
						delimitersOnScreen(result.raw),
						`a delimiter surfaced in ${JSON.stringify(result.raw)}`
					).toBe(delimitersOnScreen(display));
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

	it('no construct kind vanishes from the block', () => {
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

function isSubsequence(needle: string, haystack: string): boolean {
	let i = 0;
	for (const char of haystack) {
		if (i < needle.length && needle.startsWith(char, i)) i += char.length;
		if (i >= needle.length) return true;
	}
	return i >= needle.length;
}
