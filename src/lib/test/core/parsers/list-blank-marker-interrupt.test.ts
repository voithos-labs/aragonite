import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { canInterruptParagraph } from '../../../core/parsers/list';
import type { Document } from '../../../core/nodes';

// CommonMark §5.2's second interrupt condition: a list may interrupt a paragraph only if its
// first item is NOT empty. Readings below were taken from commonmark 0.31.2, which agrees with
// cmark-gfm here (no GFM extension touches list interruption).
//
// Miss-analysis: `list-lazy-continuation.test.ts` covered the ordered-start-at-1 half of §5.2
// and every fixture in it gave the marker content, so the empty-marker half had no pin at any
// level, and the parser read `a` over a bare `- ` as a list where the references read a heading.

function topKinds(doc: Document): string[] {
	return doc.children.map((c) => (c.kind === 'list' ? `list(${c.children!.length})` : c.kind));
}

describe('an empty marker does not interrupt a paragraph', () => {
	const cases: [name: string, source: string, top: string[]][] = [
		['bullet with only a space', 'a\n* \n', ['paragraph']],
		['dash reads as a setext underline', 'a\n- \n', ['setextHeading']],
		['plus with only a space', 'a\n+ \n', ['paragraph']],
		['ordered 1 with no content', 'a\n1. \n', ['paragraph']],
		['ordered 1) with no content', 'a\n1) \n', ['paragraph']],
		['tab after the marker, still no content', 'a\n*\t\n', ['paragraph']]
	];

	for (const [name, source, top] of cases) {
		it(name, () => {
			const doc = parse(source);
			expect(topKinds(doc)).toEqual(top);
			expect(serialize(doc)).toBe(source);
		});
	}

	// Controls: the same markers WITH content still interrupt, so the fix is the emptiness
	// condition and not a blanket refusal.
	const controls: [name: string, source: string, top: string[]][] = [
		['bullet with content', 'a\n* x\n', ['paragraph', 'list(1)']],
		['dash with content', 'a\n- x\n', ['paragraph', 'list(1)']],
		['ordered 1 with content', 'a\n1. x\n', ['paragraph', 'list(1)']],
		['tab-separated content', 'a\n-\tx\n', ['paragraph', 'list(1)']]
	];

	for (const [name, source, top] of controls) {
		it(name, () => {
			const doc = parse(source);
			expect(topKinds(doc)).toEqual(top);
			expect(serialize(doc)).toBe(source);
		});
	}
});

describe('emptiness gates interruption only, never list parsing', () => {
	it('a standalone empty marker is still a list item', () => {
		const doc = parse('- \n');
		expect(topKinds(doc)).toEqual(['list(1)']);
		expect(serialize(doc)).toBe('- \n');
	});

	// A sibling marker is the list container's own decision, taken before the interrupt
	// question is ever asked, so an empty item still follows a content-bearing one.
	it('an empty sibling item follows a content-bearing one', () => {
		const doc = parse('- x\n- \n');
		expect(topKinds(doc)).toEqual(['list(2)']);
		expect(serialize(doc)).toBe('- x\n- \n');
	});
});

describe('inside a list item, the same rule decides the sublist', () => {
	const itemKinds = (source: string) =>
		parse(source).children[0].children![0].children!.map((c) => c.kind);

	// The Enter+Tab mint's pre-separator bytes: strict GFM reads the marker line as the
	// underline of a setext heading, which is why the mint emits a blank line.
	it('an empty marker under the item’s paragraph is a setext underline', () => {
		expect(itemKinds('- x\n  - \n')).toEqual(['setextHeading']);
		expect(serialize(parse('- x\n  - \n'))).toBe('- x\n  - \n');
	});

	it('a blank line above it makes the sublist readable', () => {
		expect(itemKinds('- x\n\n  - \n')).toEqual(['paragraph', 'list']);
		expect(serialize(parse('- x\n\n  - \n'))).toBe('- x\n\n  - \n');
	});

	it('an ordered marker not starting at 1 stays lazy paragraph text', () => {
		expect(itemKinds('- x\n  2. y\n')).toEqual(['paragraph']);
	});
});

describe('canInterruptParagraph', () => {
	it('requires content after the marker', () => {
		expect(canInterruptParagraph('- x')).toBe(true);
		expect(canInterruptParagraph('   1. x')).toBe(true);
		expect(canInterruptParagraph('- ')).toBe(false);
		expect(canInterruptParagraph('1. ')).toBe(false);
		expect(canInterruptParagraph('    - x')).toBe(false);
		expect(canInterruptParagraph('2. x')).toBe(false);
	});
});
