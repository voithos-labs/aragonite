import { describe, it, expect } from 'vitest';
import type { Component } from 'svelte';
import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { defineBlockComponent } from '../../schema/block-component-registry';

const fakeComponent = (() => {}) as unknown as Parameters<typeof defineBlockComponent>[0];

describe('defineBlockComponent', () => {
	it('returns an entry carrying the same component reference', () => {
		const entry = defineBlockComponent(fakeComponent);
		expect(entry.component).toBe(fakeComponent);
		expect(entry.extraProps).toBeUndefined();
	});

	it('forwards extraProps', () => {
		const extra = (node: NodeView) => ({ blockClass: node.kind });
		const entry = defineBlockComponent(fakeComponent, extra);
		expect(entry.extraProps).toBe(extra);
		const node = { kind: 'paragraph', leadingTrivia: '', raw: 'x\n' } as CstNode;
		expect(entry.extraProps!(node)).toEqual({ blockClass: 'paragraph' });
	});

	it('rejects a component whose exports are not a BlockComponent', () => {
		const notABlock = null as unknown as Component<{ x: number }, { foo: number }>;
		// @ts-expect-error exports must structurally satisfy BlockComponent;
		// an unused directive here (a green build) means the call-site check decayed.
		defineBlockComponent(notABlock);
	});
});
