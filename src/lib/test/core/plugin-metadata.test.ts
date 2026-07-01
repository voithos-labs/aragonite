import { describe, it, expect } from 'vitest';
import { setPluginMetadata, getPluginMetadata, type CstNode } from '../../core/nodes';

interface CalloutMetadata {
	calloutType: string;
}

const bareNode = (): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw: '' });

describe('plugin metadata accessors', () => {
	it('round-trips a plugin-owned shape not present in the BlockMetadata union', () => {
		const node = bareNode();
		setPluginMetadata<CalloutMetadata>(node, { calloutType: 'warning' });
		expect(getPluginMetadata<CalloutMetadata>(node)?.calloutType).toBe('warning');
	});

	it('reads undefined when no metadata is stored', () => {
		expect(getPluginMetadata<CalloutMetadata>(bareNode())).toBeUndefined();
	});

	it('overwrites prior metadata rather than merging', () => {
		const node = bareNode();
		setPluginMetadata(node, { calloutType: 'note', dismissed: false });
		setPluginMetadata<CalloutMetadata>(node, { calloutType: 'tip' });
		expect(getPluginMetadata<Record<string, unknown>>(node)).toEqual({ calloutType: 'tip' });
	});
});
