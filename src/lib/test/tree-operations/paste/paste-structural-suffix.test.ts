// Miss-analysis: paste tests cut paragraphs and list items only, so no case pasted into a block
// with structure past its text, which the cut handed to the last pasted block.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { buildPastedReplacement } from '$lib/tree-operations/paste/paste-replacement';
import { splitLeafForPaste } from '$lib/tree-operations/list/list-builders';

const PASTED = parse('abc\n\ndef\n').children;

describe('a multi-block paste keeps the leaf’s structure past its text on the head', () => {
	it.each([
		['a heading’s closing run, at the text’s end', '# Hi #\n', 4, ['# Hi #\n', 'abc\n', 'def\n']],
		['a heading’s closing run, mid-text', '# Hi #\n', 3, ['# H #\n', 'abc\n', 'def\n', 'i\n']],
		['a setext underline, at the title’s end', 'Hi\n===\n', 2, ['Hi\n===\n', 'abc\n', 'def\n']],
		// Miss-analysis for the next two: every setext row cut at the title's end, so neither the
		// line-ending trim nor the start-of-text rule had a row that could fail.
		[
			'a setext underline, at the start of the title’s second line',
			'ab\ncd\n===\n',
			3,
			['ab\n===\n', 'abc\n', 'def\n', 'cd\n']
		],
		['a setext underline, at the title’s start', 'Hi\n===\n', 0, ['abc\n', 'def\n', 'Hi\n===\n']]
	])('%s', (_label, source, offset, raws) => {
		const leaf = parse(source).children[0];
		const { nodes } = buildPastedReplacement(leaf, offset, PASTED, '\n', defaultGrammarView);
		expect(nodes.map((node) => node.raw)).toEqual(raws);
	});

	it('a paste that splits a list item keeps the run on the leading half', () => {
		const leaf = parse('# Hi #\n').children[0];
		const { leadingNode, trailingNodes } = splitLeafForPaste(
			leaf,
			4,
			'\n',
			leaf.raw,
			defaultGrammarView
		);
		expect(leadingNode?.raw).toBe('# Hi #\n');
		expect(trailingNodes).toEqual([]);
	});
});
