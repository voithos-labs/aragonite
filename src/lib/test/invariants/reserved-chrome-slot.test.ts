import { describe, it, expect, beforeEach } from 'vitest';
import { checkReservedChromeSlot } from '../../invariants/node-shape';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { registerOpaque } from '$lib/test/harness/opaque-kind';
import type { AnyBlockKind, CstNode } from '../../core/nodes';

// A container declaring its child 0 as reserved chrome, plus the chrome leaf.
function registerChromeContainer(): { container: AnyBlockKind; chrome: AnyBlockKind } {
	const chrome = declarePluginKind('spec-chrome-title');
	registerBlockKind(chrome, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	const container = registerOpaque('spec-chrome-container', {
		rebuildRaw: () => {},
		reservedChrome: { kind: chrome }
	});
	return { container, chrome };
}

describe('checkReservedChromeSlot (G1.14)', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('passes when child 0 is the declared chrome kind', () => {
		const { container, chrome } = registerChromeContainer();
		const node: CstNode = {
			kind: container,
			leadingTrivia: '',
			raw: ':::note Title\nbody\n:::\n',
			children: [
				{ kind: chrome, leadingTrivia: '', raw: 'Title\n' },
				{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }
			]
		} as CstNode;
		expect(checkReservedChromeSlot(node)).toBeNull();
	});

	it('fires when child 0 is a foreign kind', () => {
		const { container } = registerChromeContainer();
		const node: CstNode = {
			kind: container,
			leadingTrivia: '',
			raw: ':::note\nbody\n:::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		} as CstNode;
		expect(checkReservedChromeSlot(node)?.code).toBe('reserved-chrome-slot');
	});

	it('fires when the container has no children', () => {
		const { container } = registerChromeContainer();
		const node: CstNode = {
			kind: container,
			leadingTrivia: '',
			raw: ':::note\n:::\n',
			children: []
		} as CstNode;
		expect(checkReservedChromeSlot(node)?.code).toBe('reserved-chrome-slot');
	});

	it('passes for a container that declares no reserved chrome', () => {
		const node: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '> hi\n',
			metadata: { quoteDepth: 1 },
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'hi\n' }]
		};
		expect(checkReservedChromeSlot(node)).toBeNull();
	});
});
