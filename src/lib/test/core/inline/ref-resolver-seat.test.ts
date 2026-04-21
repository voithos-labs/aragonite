import { describe, it, expect } from 'vitest';
import { parseInline, parseAllInlineContent, type RefResolver } from '$lib/editor/core/inline';
import type { CstNode } from '$lib/editor/core/nodes';

describe('parseInline — RefResolver parameter seat (0.5.5.4 reservation)', () => {
	it('accepts a resolver argument and ignores it — no-op until 0.6.6', () => {
		let calls = 0;
		const resolver: RefResolver = (_label: string) => {
			calls++;
			return null;
		};
		// Plain text — no reference-style markup that 0.6.6 will use.
		const nodes = parseInline('hello world', 0, 'hello world'.length, resolver);
		expect(nodes.length).toBeGreaterThan(0);
		// 0.5.5.4: parser does not yet consult the resolver.
		expect(calls).toBe(0);
	});

	it('is backward-compatible — parseInline without the resolver works unchanged', () => {
		const nodes = parseInline('plain text', 0, 'plain text'.length);
		expect(nodes.length).toBeGreaterThan(0);
	});

	it('parseAllInlineContent forwards the resolver through recursion (no-op today)', () => {
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
		// Parser doesn't call the resolver at 0.5.5.4. When 0.6.6 lands, this
		// assertion will flip and a reference-style link in raw will drive it.
		expect(calls).toBe(0);
		// But inline content must have been parsed on the recursion.
		expect(nodes[0].inlineContent).toBeDefined();
		expect(nodes[1].children![0].inlineContent).toBeDefined();
	});
});
