import { describe, it, expect, beforeEach } from 'vitest';
import { checkReservedChromeSlot } from '../../invariants/node-shape';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import type { CstNode } from '../../core/nodes';
import { testChromeContainer } from '$lib/test/harness/test-kinds';

describe('checkReservedChromeSlot (G1.14)', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
	});

	it('passes when child 0 is the declared chrome kind', () => {
		const { container, chrome } = testChromeContainer('spec-chrome-container', 'spec-chrome-title');
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
		const { container } = testChromeContainer('spec-chrome-container', 'spec-chrome-title');
		const node: CstNode = {
			kind: container,
			leadingTrivia: '',
			raw: ':::note\nbody\n:::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		} as CstNode;
		expect(checkReservedChromeSlot(node)?.code).toBe('reserved-chrome-slot');
	});

	it('fires when the container has no children', () => {
		const { container } = testChromeContainer('spec-chrome-container', 'spec-chrome-title');
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
