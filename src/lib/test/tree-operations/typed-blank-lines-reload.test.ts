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

describe('an Enter at block start survives the reload', () => {
	it('reloads a leading empty paragraph as a block', () => {
		const doc = parse('a\n');
		splitNode(doc, 0, 0);
		expect(serialize(doc)).toBe('\na\n');
		expect(layout(parse('\na\n').children)).toEqual(layout(doc.children));
	});
});
