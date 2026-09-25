import { describe, it, expect, beforeEach } from 'vitest';
import { ensureEditableContainers } from '../../tree-operations/node-primitives';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import type { CstNode } from '../../core/nodes';
import { testChromeContainer } from '$lib/test/harness/test-kinds';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { testContainer } from '$lib/test/harness/test-kinds';

describe('ensureEditableContainers: reserved-chrome backfill', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
	});

	it('re-creates a chrome leaf + paragraph when a chrome-declaring container empties', () => {
		const { container, chrome } = testChromeContainer('spec-chrome-container', 'spec-chrome');
		const node: CstNode = { kind: container, leadingTrivia: '', raw: '', children: [] } as CstNode;

		ensureEditableContainers(node);

		expect(node.children?.map((c) => c.kind)).toEqual([chrome, 'paragraph']);
		expect(node.children?.map((c) => c.raw)).toEqual(['\n', '\n']);
		expect(node.innerPrefix).toBe('');
	});

	it('backfills only a bare paragraph for a container with no chrome declaration', () => {
		const plain = testContainer('spec-plain-container', { rebuildRaw: () => {} });
		const node: CstNode = { kind: plain, leadingTrivia: '', raw: '', children: [] };

		ensureEditableContainers(node);

		expect(node.children?.map((c) => c.kind)).toEqual(['paragraph']);
		expect(node.innerPrefix).toBe('');
	});
});
