// A content write that leaves a setext title's last line blank drops the underline, whichever
// gesture computed the bytes: the text read from the screen, a cut, or a paste over the title.
// Miss-analysis: the rule sat in the screen read, so a cut or a paste over the whole title, which
// splice the stored bytes, kept the underline; every erase test typed the title away.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { updateNodeContent } from '../../tree-operations';
import { describeConvergence } from '../harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';

describe('a content write that empties a setext title', () => {
	it.each([
		['a cut of the whole title', 'Plan\n---\n\nnext\n', '\n---\n', '\nnext\n'],
		['a cut under a === underline', 'Plan\n===\n\nnext\n', '\n===\n', '\nnext\n'],
		['a space pasted over the title', 'Plan\n---\n\nnext\n', ' \n---\n', ' \nnext\n'],
		['CRLF endings', 'Plan\r\n===\r\n\r\nnext\r\n', '\r\n===\r\n', '\r\nnext\r\n'],
		['the last line of a two-line title', 'Plan\nmore\n---\n', 'Plan\n\n---\n', 'Plan\n\n']
	])('%s leaves a paragraph and no underline', (_label, source, written, result) => {
		const doc = parse(source);

		updateNodeContent(doc, 0, written, defaultGrammarView);

		expect(serialize(doc)).toBe(result);
		expect(doc.children.map((c) => c.kind)).not.toContain('thematicBreak');
		expect(doc.children[0].kind).toBe('paragraph');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('inside a quote, leaves a paragraph and no underline', () => {
		const doc = parse('> Plan\n> ---\n');
		const quote = doc.children[0];

		updateNodeContent(
			{ children: quote.children!, ownerKind: 'blockquote', owner: quote },
			0,
			'\n---\n',
			defaultGrammarView
		);

		expect(quote.children!.map((c) => c.kind)).toEqual(['paragraph']);
		expect(quote.children![0].raw).toBe('\n');
	});

	it.each([
		['a title with text left', 'Plan\n---\n', 'Pl\n---\n'],
		['a title left as a no-break space, which Markdown reads as text', 'Plan\n===\n', ' \n===\n']
	])('keeps the underline under %s', (_label, source, written) => {
		const doc = parse(source);

		updateNodeContent(doc, 0, written, defaultGrammarView);

		expect(serialize(doc)).toBe(written);
		expect(doc.children.map((c) => c.kind)).toEqual(['setextHeading']);
	});
});
