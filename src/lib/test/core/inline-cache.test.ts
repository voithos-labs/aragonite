import { defaultGrammarView } from '$lib/schema/block-openers';
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { getInlineContent } from '../../core/inline/inline-cache';
import { buildLinkReferenceMap } from '../../core/inline/link-reference-resolver';
import type { CstNode } from '../../core/nodes';

function firstProse(src: string): CstNode {
	return parse(src).children[0];
}

describe('getInlineContent', () => {
	it('returns the inline tree for a prose node', () => {
		const node = firstProse('a **b** c\n');
		const content = getInlineContent(node, undefined, undefined, defaultGrammarView);
		expect(content.some((n) => n.kind === 'strong')).toBe(true);
	});

	it('returns the same cached array on a repeat read (no raw change)', () => {
		const node = firstProse('hello *world*\n');
		expect(getInlineContent(node, undefined, undefined, defaultGrammarView)).toBe(
			getInlineContent(node, undefined, undefined, defaultGrammarView)
		);
	});

	it('recomputes after an in-place raw change', () => {
		const node = firstProse('plain\n');
		const before = getInlineContent(node, undefined, undefined, defaultGrammarView);
		node.raw = 'now **bold**\n';
		const after = getInlineContent(node, undefined, undefined, defaultGrammarView);
		expect(after).not.toBe(before);
		expect(after.some((n) => n.kind === 'strong')).toBe(true);
	});

	it('recomputes a bracket block when the signature changes; ignores signature for bracketless', () => {
		const ref = firstProse('see [x]\n');
		const a = getInlineContent(ref, undefined, 'sig-1', defaultGrammarView);
		const b = getInlineContent(ref, undefined, 'sig-2', defaultGrammarView);
		expect(b).not.toBe(a);
		const plain = firstProse('no brackets here\n');
		expect(getInlineContent(plain, undefined, 'sig-2', defaultGrammarView)).toBe(
			getInlineContent(plain, undefined, 'sig-9', defaultGrammarView)
		);
	});

	it('a copied node (new object, same raw) computes its own entry', () => {
		const node = firstProse('shared *text*\n');
		const originalContent = getInlineContent(node, undefined, undefined, defaultGrammarView);
		const copy: CstNode = { ...node };
		const copyContent = getInlineContent(copy, undefined, undefined, defaultGrammarView);
		expect(copyContent).not.toBe(originalContent);
		expect(copyContent.some((n) => n.kind === 'emphasis')).toBe(true);
	});

	it('returns [] for a non-prose node', () => {
		const code = parse('```\ncode\n```\n').children[0];
		expect(getInlineContent(code, undefined, undefined, defaultGrammarView)).toEqual([]);
	});

	it('forwards the resolver so a reference-style link resolves to a link node', () => {
		const src = 'see [text][ref]\n\n[ref]: https://example.com\n';
		const doc = parse(src);
		const map = buildLinkReferenceMap(doc.children);

		const resolved = getInlineContent(
			doc.children[0],
			map.resolve,
			map.signature,
			defaultGrammarView
		);
		const link = resolved.find((n) => n.kind === 'link');
		expect(link).toBeDefined();
		expect(link?.url).toBe('https://example.com');
		expect(resolved.some((n) => n.kind === 'unresolvedReference')).toBe(false);

		// Parsed fresh so the WeakMap entry from the resolved read above cannot mask the miss.
		const fresh = parse(src).children[0];
		const unforwarded = getInlineContent(fresh, undefined, '', defaultGrammarView);
		expect(unforwarded.some((n) => n.kind === 'link')).toBe(false);
	});

	// The plain (sig-'') and resolved (real-signature) callers hold separate slots, so
	// interleaving them on a bracket-bearing block must not evict either side.
	it('does not evict across interleaved plain and resolved reads on a bracket block', () => {
		const doc = parse('see [a][x]\n\n[x]: https://example.com\n');
		const node = doc.children[0];
		const map = buildLinkReferenceMap(doc.children);

		const a1 = getInlineContent(node, undefined, undefined, defaultGrammarView);
		const b1 = getInlineContent(node, map.resolve, map.signature, defaultGrammarView);
		const a2 = getInlineContent(node, undefined, undefined, defaultGrammarView);
		const b2 = getInlineContent(node, map.resolve, map.signature, defaultGrammarView);

		expect(a2).toBe(a1);
		expect(b2).toBe(b1);
	});

	it('recomputes both slots after a raw change', () => {
		const doc = parse('see [a][x]\n\n[x]: https://example.com\n');
		const node = doc.children[0];
		const map = buildLinkReferenceMap(doc.children);

		const plainBefore = getInlineContent(node, undefined, undefined, defaultGrammarView);
		const resolvedBefore = getInlineContent(node, map.resolve, map.signature, defaultGrammarView);

		node.raw = 'now [a][x] moved\n';

		expect(getInlineContent(node, undefined, undefined, defaultGrammarView)).not.toBe(plainBefore);
		expect(getInlineContent(node, map.resolve, map.signature, defaultGrammarView)).not.toBe(
			resolvedBefore
		);
	});

	it('recomputes only the resolved slot when the signature changes', () => {
		const doc = parse('see [a][x]\n\n[x]: https://example.com\n');
		const node = doc.children[0];
		const map = buildLinkReferenceMap(doc.children);

		const plainRead = getInlineContent(node, undefined, undefined, defaultGrammarView);
		const resolvedRead = getInlineContent(node, map.resolve, map.signature, defaultGrammarView);

		const rebumped = getInlineContent(
			node,
			map.resolve,
			`${map.signature}|y<:>u<:>`,
			defaultGrammarView
		);
		expect(rebumped).not.toBe(resolvedRead);
		expect(getInlineContent(node, undefined, undefined, defaultGrammarView)).toBe(plainRead);
	});
});
