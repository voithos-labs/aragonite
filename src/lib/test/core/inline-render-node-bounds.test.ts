// @vitest-environment jsdom
// Miss-analysis (C-M6): every render fixture came from parseInline, whose nodes are
// well-formed by construction, so no case asked what a decomposing renderer emits over a node
// a plugin rung minted — the built-in kinds `stampClaim` sanctions — and the searches that
// read past `node.end` had nothing to fail against.
import { describe, it, expect } from 'vitest';
import { renderInlineNodes } from '../../core/inline-render';
import type { InlineNode } from '../../core/nodes';

function renderedText(node: InlineNode, raw: string): string {
	const div = document.createElement('div');
	div.appendChild(renderInlineNodes([node], raw));
	return div.textContent ?? '';
}

describe('a decomposing renderer emits exactly its own bytes (G2.4)', () => {
	// Each raw puts the byte the renderer searches for OUTSIDE the node, so an unbounded
	// search renders the next node's source into this node's spans.
	const shapes: { name: string; node: InlineNode; raw: string }[] = [
		{
			name: 'link with no closing bracket and no children',
			node: { kind: 'link', start: 0, end: 6, url: '/page' },
			raw: '[[page and a ] later'
		},
		{
			name: 'link whose children end at the node end',
			node: {
				kind: 'link',
				start: 0,
				end: 5,
				url: '/u',
				children: [{ kind: 'text', start: 1, end: 5 }]
			},
			raw: '[text] tail'
		},
		{
			name: 'inline code that is more than half fence',
			node: { kind: 'inlineCode', start: 0, end: 3 },
			raw: '``x`` tail'
		},
		{
			name: 'hard line break with no line ending',
			node: { kind: 'hardLineBreak', start: 0, end: 2 },
			raw: '  \nrest'
		}
	];

	for (const { name, node, raw } of shapes) {
		it(`renders a ${name} byte-for-byte`, () => {
			expect(renderedText(node, raw)).toBe(raw.slice(node.start, node.end));
		});
	}
});
