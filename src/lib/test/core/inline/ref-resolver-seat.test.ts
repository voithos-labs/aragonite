import { describe, it, expect } from 'vitest';
import { parseInline, parseAllInlineContent, type RefResolver } from '$lib/editor/core/inline';
import type { CstNode } from '$lib/editor/core/nodes';

describe('parseInline — RefResolver parameter seat', () => {
	it('accepts a resolver argument and ignores it', () => {
		let calls = 0;
		const resolver: RefResolver = (_label: string) => {
			calls++;
			return null;
		};
		const nodes = parseInline('hello world', 0, 'hello world'.length, resolver);
		expect(nodes.length).toBeGreaterThan(0);
		expect(calls).toBe(0);
	});

	it('is backward-compatible — parseInline without the resolver works unchanged', () => {
		const nodes = parseInline('plain text', 0, 'plain text'.length);
		expect(nodes.length).toBeGreaterThan(0);
	});

	it('parseInline with a link forwards the resolver into nested link-text parsing', () => {
		let calls = 0;
		const resolver: RefResolver = () => {
			calls++;
			return null;
		};
		const input = '[**hello**](https://example.com)';
		parseInline(input, 0, input.length, resolver);
		expect(calls).toBe(0);
	});

	it('parseAllInlineContent forwards the resolver through recursion', () => {
		let calls = 0;
		const resolver: RefResolver = () => {
			calls++;
			return null;
		};
		const nodes: CstNode[] = [
			{ kind: 'paragraph', leadingTrivia: '', raw: 'hello\n' },
			{
				kind: 'blockquote',
				leadingTrivia: '',
				raw: '> nested\n',
				children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'nested\n' }]
			}
		];
		parseAllInlineContent(nodes, resolver);
		expect(calls).toBe(0);
		expect(nodes[0].inlineContent).toBeDefined();
		expect(nodes[1].children![0].inlineContent).toBeDefined();
	});
});
