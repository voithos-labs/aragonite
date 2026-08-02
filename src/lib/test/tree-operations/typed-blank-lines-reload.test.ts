import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { splitNode, updateNodeContent } from '$lib/tree-operations/node-ops';
import type { CstNode, Document } from '$lib/core/nodes';

// The typing ≡ loading spine at tree level: the simulation compares source BYTES across the
// two paths, so a shape that only the typed side holds survived it.

const layout = (nodes: readonly CstNode[]): [string, string, string][] =>
	nodes.map((n) => [n.kind, n.leadingTrivia, n.raw]);

/** "1", Enter, Enter, "2" — the 0.9.36 Enter-split byte policy, driven through the ops. */
function typeOneEnterEnterTwo(): Document {
	const doc = parse('1\n');
	splitNode(doc, 0, 1);
	splitNode(doc, 1, 0);
	updateNodeContent(doc, 2, '2\n');
	return doc;
}

describe('a typed blank line survives the reload', () => {
	it('holds the Enter-split byte policy', () => {
		const doc = parse('1\n');
		splitNode(doc, 0, 1);
		expect(serialize(doc)).toBe('1\n\n\n');
		splitNode(doc, 1, 0);
		expect(serialize(doc)).toBe('1\n\n\n\n');
		updateNodeContent(doc, 2, '2\n');
		expect(serialize(doc)).toBe('1\n\n\n2\n');
	});

	it('reloads to the shape it was typed into', () => {
		const typed = typeOneEnterEnterTwo();
		expect(layout(parse(serialize(typed)).children)).toEqual(layout(typed.children));
	});

	it('keeps the empty paragraph a live block, not trivia', () => {
		const reloaded = parse(serialize(typeOneEnterEnterTwo()));
		expect(reloaded.children.map((n) => n.raw)).toEqual(['1\n', '\n', '2\n']);
	});
});

// The tree spine under the typed-fence e2e gesture, which pinned the pre-materialization shape
// (a lone blank line was document whitespace, so typing minted a block BELOW it) until this rule
// made it a block of its own.
describe('a lone blank document is the block you type into', () => {
	it('fills that block rather than leaving a blank line above the new one', () => {
		const doc = parse('\n');
		expect(layout(doc.children)).toEqual([['paragraph', '', '\n']]);

		updateNodeContent(doc, 0, '```\ncode\n```\n');

		expect(serialize(doc)).toBe('```\ncode\n```\n');
		expect(layout(doc.children)).toEqual([['fencedCode', '', '```\ncode\n```\n']]);
		expect(layout(parse(serialize(doc)).children)).toEqual(layout(doc.children));
	});
});

// A blank block opened above an existing separator carries none of its own — the run below opens
// it. Typing there ends the blank line, and with it the arrangement that let the separator go.
// Miss-analysis: the split's own bytes were pinned, and so was typing into a blank line at the
// document tail (where the blank half does carry a separator); no case typed into a blank line
// with a block below it, the one shape whose reload merged the halves back.
describe('typing into the blank line an Enter opened', () => {
	it('takes back the separator the blank line was standing in for', () => {
		const doc = parse('Hello world\n\nSecond paragraph\n');
		splitNode(doc, 0, 11);
		expect(serialize(doc)).toBe('Hello world\n\n\nSecond paragraph\n');

		updateNodeContent(doc, 1, 'x\n');

		expect(serialize(doc)).toBe('Hello world\n\nx\n\nSecond paragraph\n');
		expect(layout(parse(serialize(doc)).children)).toEqual(layout(doc.children));
	});

	it('mints none at the tail, where the blank half already carried one', () => {
		const doc = parse('Hello world\n');
		splitNode(doc, 0, 11);
		updateNodeContent(doc, 1, 'x\n');

		expect(serialize(doc)).toBe('Hello world\n\nx\n');
	});

	it('mints none below a blank predecessor, which is the separating line', () => {
		const doc = parse('a\n\n\n\nb\n');
		expect(layout(doc.children)).toEqual([
			['paragraph', '', 'a\n'],
			['paragraph', '\n', '\n'],
			['paragraph', '', '\n'],
			['paragraph', '', 'b\n']
		]);

		updateNodeContent(doc, 2, 'x\n');

		expect(serialize(doc)).toBe('a\n\n\nx\nb\n');
	});
});

describe('an Enter at block start survives the reload', () => {
	it('reloads a leading empty paragraph as a block', () => {
		const doc = parse('a\n');
		splitNode(doc, 0, 0);
		expect(serialize(doc)).toBe('\na\n');
		expect(layout(parse('\na\n').children)).toEqual(layout(doc.children));
	});
});
