import { describe, it, expect } from 'vitest';
import { dumpInlineTree } from '../../debug/inspect';
import type { InlineNode } from '../../core/nodes';

describe('dumpInlineTree', () => {
	it('surfaces decoded character on entityReference nodes', () => {
		const nodes: InlineNode[] = [
			{ kind: 'entityReference', start: 0, end: 6, decoded: '©' }
		];
		const out = dumpInlineTree(nodes);
		expect(out).toContain('entityReference');
		expect(out).toContain('decoded="©"');
	});

	it('omits decoded field on non-entity nodes', () => {
		const nodes: InlineNode[] = [{ kind: 'text', start: 0, end: 3, text: 'foo' }];
		expect(dumpInlineTree(nodes)).not.toContain('decoded=');
	});
});
