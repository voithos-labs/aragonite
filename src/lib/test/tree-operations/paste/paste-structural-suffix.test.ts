// Miss-analysis: no paste case cut a block with structure past its text.
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
		// Miss-analysis for the next two: every setext row cut at the title's end.
		[
			'a setext underline, at the start of the title’s second line',
			'ab\ncd\n===\n',
			3,
			['ab\n===\n', 'abc\n', 'def\n', 'cd\n']
		],
		['a setext underline, at the title’s start', 'Hi\n===\n', 0, ['abc\n', 'def\n', 'Hi\n===\n']],
		// Miss-analysis for the next three (#623): every head-of-text row cut a setext title, whose
		// text starts at 0, so no row cut an ATX heading between its marker and its text.
		['an ATX heading, at the text’s start', '# Hi\n', 2, ['abc\n', 'def\n', '# Hi\n']],
		[
			'an ATX heading with a closing run, at the text’s start',
			'# Hi #\n',
			2,
			['abc\n', 'def\n', '# Hi #\n']
		],
		['an ATX heading, inside its marker', '## Hi\n', 1, ['abc\n', 'def\n', '## Hi\n']]
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

	it('a paste that splits a list item at a heading’s text start moves the whole heading', () => {
		const leaf = parse('# Hi\n').children[0];
		const { leadingNode, trailingNodes } = splitLeafForPaste(
			leaf,
			2,
			'\n',
			leaf.raw,
			defaultGrammarView
		);
		expect(leadingNode).toBeNull();
		expect(trailingNodes.map((node) => node.raw)).toEqual(['# Hi\n']);
	});
});
