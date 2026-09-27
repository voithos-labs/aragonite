import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';

// A same-kind write beside a block that can take the lines below it as its own (a link definition's
// title, an HTML block left open) asks whether the two now read as one.
// Miss-analysis: the same-kind skip was pinned against a list above, whose reach depends on the
// first line's indent; no case put a block that reads the lines below it over the written one.

describe('a same-kind write next to a block that reads the lines below it', () => {
	it.each([
		['a two-line title closed', '[a]: /u\n"x\nmore\n', '"x\nmore"\n'],
		['a one-line title closed', '[a]: /u\n"x\n', '"x"\n'],
		['a paragraph quoted whole', '[a]: /u\nx\n', '"x"\n']
	])('the definition takes the paragraph below as its title: %s', (_label, source, text) => {
		const doc = parse(source);
		updateNodeContent(doc, 1, text, defaultGrammarView);
		expect(doc.children.map((c) => c.kind)).toEqual(['linkReferenceDefinition']);
		expectParseConverged(doc);
	});

	it('a definition that drops its own title takes the paragraph below as one', () => {
		const doc = parse('[a]: /u \'t\'\n"y"\n');
		updateNodeContent(doc, 0, '[a]: /u\n', defaultGrammarView);
		expect(doc.children.map((c) => c.kind)).toEqual(['linkReferenceDefinition']);
		expectParseConverged(doc);
	});

	it.each([
		['a comment losing its closer', '<!-- note -->\nText\n', '<!-- note --\n'],
		['a multi-line comment losing its closer', '<!--\na\n-->\nmore\n', '<!--\na\n--\n'],
		['a pre block losing its closer', '<pre>\na\n</pre>\nmore\n', '<pre>\na\n</pr>\n']
	])('an HTML block left open takes the paragraph below: %s', (_label, source, text) => {
		const doc = parse(source);
		updateNodeContent(doc, 0, text, defaultGrammarView);
		expect(doc.children.map((c) => c.kind)).toEqual(['htmlBlock']);
		expectParseConverged(doc);
	});
});
