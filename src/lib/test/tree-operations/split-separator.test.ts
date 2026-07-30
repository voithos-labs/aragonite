// Enter mints the successor's blank-line separator when the first half would
// otherwise lazily absorb it. Asserted through `describeConvergence`, not through
// bytes: the defect this guards is the LIVE tree disagreeing with a reparse of its
// own serialization, which every byte-level oracle is blind to (the round trip is a
// tautology, G2.1).
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode } from '../../tree-operations';
import { rebuildBlockquoteRaw } from '../../schema/container-rebuilders';
import { describeConvergence } from '../../testing/parse-convergence';

describe('split separator — the half that absorbs gets one', () => {
	it('Enter at the end of a paragraph, then typing, still reparses as two blocks', () => {
		const doc = parse('Hello world\n');
		splitNode(doc, 0, 'Hello world'.length);
		doc.children[1].raw = 'x\n';

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('Hello world\n\nx\n');
	});

	it('Enter mid-paragraph reparses as two blocks', () => {
		const doc = parse('Hello world\n');
		splitNode(doc, 0, 5);

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('Hello\n\n world\n');
	});

	it('the separator takes the block line ending, not a literal LF', () => {
		const doc = parse('Hello world\r\n');
		splitNode(doc, 0, 5);

		expect(doc.children[1].leadingTrivia).toBe('\r\n');
	});

	it('a blockquote child split reparses as two quoted paragraphs', () => {
		const doc = parse('> Risk noted,\n');
		const quote = doc.children[0];
		splitNode({ children: quote.children! }, 0, 'Risk noted,'.length);
		quote.children![1].raw = 'so we sequence it later.\n';
		rebuildBlockquoteRaw(quote);

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('> Risk noted,\n>\n> so we sequence it later.\n');
	});
});

describe('split separator — the halves that close get none', () => {
	// Over-minting is not a convergence defect, so convergence cannot guard these.
	// Each closes on its own, so a following line already starts its own block, and a
	// blank would widen the document's spacing for nothing.
	const closesOnItsOwn: readonly [name: string, source: string, offset: number][] = [
		['heading', '## Title\n', 8],
		['thematic break', '---\n', 3],
		['setext heading', 'Title\n=====\n', 5]
	];

	for (const [name, source, offset] of closesOnItsOwn) {
		it(`${name}`, () => {
			const doc = parse(source);
			splitNode(doc, 0, offset);
			expect(doc.children[1].leadingTrivia).toBe('');
		});
	}

	it('an offset-0 split, whose first half is the empty placeholder', () => {
		const doc = parse('Hello\n');
		splitNode(doc, 0, 0);
		expect(doc.children[1].leadingTrivia).toBe('');
		expect(serialize(doc)).toBe('\nHello\n');
	});
});
