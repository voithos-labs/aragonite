import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { splitNode } from '../../tree-operations';
import { describeConvergence } from '../../testing/parse-convergence';

// The setext underline sits AFTER the title, so a plain raw cut strands it in the second
// half, where `=====` reparses as a junk paragraph and `-----` demotes the heading.
describe('setext heading split', () => {
	for (const underline of ['=====', '-----']) {
		const source = `Title\n${underline}\n`;

		it(`Enter at the title end keeps the ${underline} underline with the heading`, () => {
			const doc = parse(source);
			splitNode(doc, 0, 5, undefined, undefined);
			expect(doc.children).toHaveLength(2);
			expect(doc.children[0].kind).toBe('setextHeading');
			expect(doc.children[0].raw).toBe(source);
			expect(doc.children[1].kind).toBe('paragraph');
			expect(doc.children[1].raw).toBe('\n');
		});

		it(`Enter mid-title keeps the ${underline} underline with the heading half`, () => {
			const doc = parse(source);
			splitNode(doc, 0, 2, undefined, undefined);
			expect(doc.children).toHaveLength(2);
			expect(doc.children[0].kind).toBe('setextHeading');
			expect(doc.children[0].raw).toBe(`Ti\n${underline}\n`);
			expect(doc.children[1].kind).toBe('paragraph');
			expect(doc.children[1].raw).toBe('tle\n');
		});
	}

	it('Enter at offset 0 keeps the empty-block-above behavior', () => {
		const source = 'Title\n=====\n';
		const doc = parse(source);
		splitNode(doc, 0, 0, undefined, undefined);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('\n');
		expect(doc.children[1].kind).toBe('setextHeading');
		expect(doc.children[1].raw).toBe(source);
	});

	it('splits a CRLF setext heading with the underline preserved on the heading', () => {
		const source = 'Title\r\n=====\r\n';
		const doc = parse(source);
		splitNode(doc, 0, 5, undefined, undefined);
		expect(doc.children[0].kind).toBe('setextHeading');
		expect(doc.children[0].raw).toBe(source);
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('\r\n');
	});
});

// GH #99: a cut on a content line's trailing whitespace left the second half opening with a
// whitespace-only line, which a reload reads as blank and folds into trivia. The cut consumes
// that whitespace into the first half — the arm that keeps `serialize(parse(x)) === x` —
// exactly as `cutPastLineEnding` consumes a bare ending.
// Miss-analysis: every setext pin cut on a letter or a line boundary; none put the caret
// inside a content line's trailing whitespace run.
describe('setext split cutting on trailing whitespace', () => {
	it('consumes the whitespace into the first half instead of minting a blank line', () => {
		const doc = parse('Title \nMore\n=====\n');
		splitNode(doc, 0, 5, undefined, undefined);
		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['setextHeading', 'Title \n=====\n'],
			['paragraph', 'More\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('the CRLF twin', () => {
		const doc = parse('Title \r\nMore\r\n=====\r\n');
		splitNode(doc, 0, 5, undefined, undefined);
		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['setextHeading', 'Title \r\n=====\r\n'],
			['paragraph', 'More\r\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('consumes a multi-space run whole', () => {
		const doc = parse('Title   \nMore\n=====\n');
		splitNode(doc, 0, 6, undefined, undefined);
		expect(doc.children[0].raw).toBe('Title   \n=====\n');
		expect(doc.children[1].raw).toBe('More\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	// A remainder that is ONLY whitespace has no content line to protect: the blank-half arm
	// already separates it correctly, so the whitespace stays with the second half.
	it('leaves an all-whitespace remainder to the blank-half arm', () => {
		const doc = parse('More \n=====\n');
		splitNode(doc, 0, 4, undefined, undefined);
		expect(doc.children[0].kind).toBe('setextHeading');
		expect(describeConvergence(doc)).toBeNull();
	});
});
