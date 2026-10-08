import { describe, it, expect } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { docPathFrom } from '#lib/cursor/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { legalizeWrite, updateNodeContent } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { spliceChildrenSettled } from '#lib/tree-operations/settle.js';

// A write that keeps its block's kind still asks whether a reload reads it and a neighbour as one:
// the block above when no blank line parts them, the block below whatever parts them.
// Miss-analysis: the same-kind skip asked only beside kinds listed as reading the lines below them,
// and then only flush ones, so no row wrote a block whose first line decides whether it interrupts
// the one above, or left an HTML block open over a blank line.

const kinds = (source: string, index: number, text: string): string[] => {
	const doc = parse(source);
	updateNodeContent(doc, index, text, defaultGrammarView, createSharingState());
	expectParseConverged(doc);
	return doc.children.map((c) => c.kind);
};

/** The document after `text` is written over the leaf at `leaf` through the keystroke route. */
function typedInPlace(source: string, leaf: number[], text: string) {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	const owner = leaf.length > 1 ? (blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode) : null;
	const target = owner ? { children: owner.children!, owner, lineEnding: '\n' as const } : deps.doc;
	const write = legalizeWrite(target, leaf[leaf.length - 1], text, 'authored');

	expect(typing.writeLeafInPlace(docPathFrom(leaf), write, 0).wrote).toBe(true);
	expectParseConverged(deps.doc);
	return deps.doc;
}

describe('a same-kind write asks every flush join it sits in', () => {
	it('an HTML block that can no longer interrupt joins the paragraph above (GH #638)', () => {
		expect(kinds('foo\n<div>\n', 1, '<span>\n')).toEqual(['paragraph']);
	});

	it('the keystroke route joins it the same way (GH #638)', () => {
		const doc = typedInPlace('foo\n<div>\n', [1], '<span>\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph']);
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

// No keystroke writes a container whole (its leaf writes, and the container's own position is
// asked on the way out of its rebuild), so these hold the write's contract for any other caller.
describe('a container written whole asks its flush joins too', () => {
	it.each([
		['an ordered list that no longer starts at one', 'foo\n1. a\n', 1, '2. a\n', ['paragraph']],
		['a list whose heading became text', '- # h\nfoo\n', 0, '- h\n', ['list']],
		['a quote whose heading became text', '> # h\nfoo\n', 0, '> h\n', ['blockquote']]
	])('the flush pair reads as one: %s', (_label, source, index, text, expected) => {
		expect(kinds(source, index, text)).toEqual(expected);
	});
});

describe('a same-kind write asks the join below past blank lines', () => {
	it.each([
		['a comment losing its closer', '<!-- note -->\n\nText\n', '<!-- note --\n'],
		['a div retyped as a pre', '<div>\n\nfoo\n', '<pre>\n'],
		['a processing instruction losing its closer', '<?x ?>\n\nfoo\n', '<?x\n'],
		['a CDATA section losing its closer', '<![CDATA[x]]>\n\nfoo\n', '<![CDATA[x\n'],
		['a pre block losing its closer', '<pre>\na\n</pre>\n\nmore\n', '<pre>\na\n</pr>\n']
	])('an HTML block left open takes the blocks below: %s', (_label, source, text) => {
		expect(kinds(source, 0, text)).toEqual(['htmlBlock']);
	});

	it('a comment losing its closer inside a list item takes the paragraph below', () => {
		const doc = typedInPlace('- a\n\n  <!-- x -->\n\n  b\n', [0, 0, 1], '<!-- x --\n');
		expect(doc.children[0].children![0].children!.map((c) => c.kind)).toEqual([
			'paragraph',
			'htmlBlock'
		]);
	});

	it('a paragraph a blank line above a list stays its own', () => {
		expect(kinds('foo\n\n- a\n', 0, 'foo bar\n')).toEqual(['paragraph', 'list']);
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
