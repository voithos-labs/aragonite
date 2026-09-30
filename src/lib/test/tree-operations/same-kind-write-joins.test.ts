import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite, updateNodeContent } from '$lib/tree-operations/content-write';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createSharingState } from '$lib/tree-operations/sharing';
import { spliceChildrenSettled } from '$lib/tree-operations/settle';

// A write that keeps its block's kind still asks each join where the block sits flush against a
// neighbour whether a reload reads the two as one.
// Miss-analysis: the same-kind skip asked only beside kinds listed as reading the lines below them,
// so no row wrote a block whose own first line decides whether it interrupts the one above.

const kinds = (source: string, index: number, text: string): string[] => {
	const doc = parse(source);
	updateNodeContent(doc, index, text, defaultGrammarView, createSharingState());
	expectParseConverged(doc);
	return doc.children.map((c) => c.kind);
};

describe('a same-kind write asks every flush join it sits in', () => {
	it('an HTML block that can no longer interrupt joins the paragraph above (GH #638)', () => {
		expect(kinds('foo\n<div>\n', 1, '<span>\n')).toEqual(['paragraph']);
	});

	it('the keystroke route joins it the same way (GH #638)', () => {
		const { deps } = makeEditorActionsDeps('foo\n<div>\n');
		const typing = createLeafTyping(deps, createUndoController(deps));
		const body = { children: deps.doc.children, owner: undefined, lineEnding: '\n' as const };
		const write = legalizeWrite(body, 1, '<span>\n', 'authored');

		expect(typing.writeLeafInPlace(docPathFrom([1]), write, 0).wrote).toBe(true);
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['paragraph']);
		expectParseConverged(deps.doc);
	});

	it.each([
		['an ordered list that no longer starts at one', 'foo\n1. a\n', 1, '2. a\n', ['paragraph']],
		['a list whose heading became text', '- # h\nfoo\n', 0, '- h\n', ['list']],
		['a quote whose heading became text', '> # h\nfoo\n', 0, '> h\n', ['blockquote']]
	])('the flush pair reads as one: %s', (_label, source, index, text, expected) => {
		expect(kinds(source, index, text)).toEqual(expected);
	});

	it.each([
		['a paragraph over a list', 'foo\n- a\n', 0, 'foo bar\n', ['paragraph', 'list']],
		['a paragraph over a quote', 'foo\n> a\n', 0, 'foo bar\n', ['paragraph', 'blockquote']],
		['a list over a heading', '- a\n# h\n', 0, '- ab\n', ['list', 'heading']],
		['a paragraph over an HTML block', 'foo\n<div>\n', 0, 'foo bar\n', ['paragraph', 'htmlBlock']]
	])('the flush pair still reads as two: %s', (_label, source, index, text, expected) => {
		expect(kinds(source, index, text)).toEqual(expected);
	});
});

describe('a same-kind write next to a block that reads the lines below it', () => {
	it.each([
		['a two-line title closed', '[a]: /u\n"x\nmore\n', '"x\nmore"\n'],
		['a one-line title closed', '[a]: /u\n"x\n', '"x"\n'],
		['a paragraph quoted whole', '[a]: /u\nx\n', '"x"\n']
	])('the definition takes the paragraph below as its title: %s', (_label, source, text) => {
		expect(kinds(source, 1, text)).toEqual(['linkReferenceDefinition']);
	});

	it('a definition that drops its own title takes the paragraph below as one', () => {
		expect(kinds('[a]: /u \'t\'\n"y"\n', 0, '[a]: /u\n')).toEqual(['linkReferenceDefinition']);
	});

	it('a definition that drops its own title takes a two-line title below it', () => {
		expect(kinds('[a]: /u \'t\'\n"y\nz"\n', 0, '[a]: /u\n')).toEqual(['linkReferenceDefinition']);
	});

	it('a paragraph spliced under a definition becomes its two-line title', () => {
		const doc = parse('[a]: /u\n');
		const [title] = parse('"x\nmore"\n').children;
		spliceChildrenSettled(doc, 1, 0, [title], defaultGrammarView, createSharingState(), '\n');

		expect(doc.children.map((c) => c.kind)).toEqual(['linkReferenceDefinition']);
		expectParseConverged(doc);
	});

	it.each([
		['a comment losing its closer', '<!-- note -->\nText\n', '<!-- note --\n'],
		['a multi-line comment losing its closer', '<!--\na\n-->\nmore\n', '<!--\na\n--\n'],
		['a pre block losing its closer', '<pre>\na\n</pre>\nmore\n', '<pre>\na\n</pr>\n']
	])('an HTML block left open takes the paragraph below: %s', (_label, source, text) => {
		expect(kinds(source, 0, text)).toEqual(['htmlBlock']);
	});
});
