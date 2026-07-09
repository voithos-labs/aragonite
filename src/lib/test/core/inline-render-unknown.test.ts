// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderInlineNodes } from '$lib/core/inline-render';
import type { InlineNode } from '$lib/core/nodes';

describe('unknown inline kind render', () => {
	it('renders an unregistered kind as a raw-source span; textContent === raw slice', () => {
		const raw = 'a $x$ b';
		const node = { kind: 'math', start: 2, end: 5 } as unknown as InlineNode; // $x$
		const frag = renderInlineNodes(
			[
				{ kind: 'text', start: 0, end: 2, text: 'a ' },
				node,
				{ kind: 'text', start: 5, end: 7, text: ' b' }
			],
			raw
		);
		const host = document.createElement('div');
		host.appendChild(frag);
		expect(host.textContent).toBe('a $x$ b');
		expect(host.querySelector('.md-unknown-inline')?.textContent).toBe('$x$');
	});
});
