import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { getInlineContent } from '../../core/inline/inline-cache';
import type { CstNode } from '../../core/nodes';

function firstProse(src: string): CstNode {
	return parse(src).children[0];
}

describe('getInlineContent', () => {
	it('returns the inline tree for a prose node', () => {
		const node = firstProse('a **b** c\n');
		const content = getInlineContent(node);
		expect(content.some((n) => n.kind === 'strong')).toBe(true);
	});

	it('returns the same cached array on a repeat read (no raw change)', () => {
		const node = firstProse('hello *world*\n');
		expect(getInlineContent(node)).toBe(getInlineContent(node));
	});

	it('recomputes after an in-place raw change', () => {
		const node = firstProse('plain\n');
		const before = getInlineContent(node);
		node.raw = 'now **bold**\n';
		const after = getInlineContent(node);
		expect(after).not.toBe(before);
		expect(after.some((n) => n.kind === 'strong')).toBe(true);
	});

	it('recomputes a bracket block when the signature changes; ignores signature for bracketless', () => {
		const ref = firstProse('see [x]\n');
		const a = getInlineContent(ref, undefined, 'sig-1');
		const b = getInlineContent(ref, undefined, 'sig-2');
		expect(b).not.toBe(a);
		const plain = firstProse('no brackets here\n');
		expect(getInlineContent(plain, undefined, 'sig-2')).toBe(
			getInlineContent(plain, undefined, 'sig-9')
		);
	});

	it('a copied node (new object, same raw) computes its own entry', () => {
		const node = firstProse('shared *text*\n');
		const originalContent = getInlineContent(node);
		const copy: CstNode = { ...node };
		const copyContent = getInlineContent(copy);
		expect(copyContent).not.toBe(originalContent);
		expect(copyContent.some((n) => n.kind === 'emphasis')).toBe(true);
	});

	it('returns [] for a non-prose node', () => {
		const code = parse('```\ncode\n```\n').children[0];
		expect(getInlineContent(code)).toEqual([]);
	});
});
