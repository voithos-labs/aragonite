import { describe, it, expect, beforeEach } from 'vitest';
import { ensureEditableContainers } from '../../tree-operations/node-ops';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { AnyBlockKind, CstNode } from '../../core/nodes';

function registerChromeContainer(): { container: AnyBlockKind; chrome: AnyBlockKind } {
	const chrome = declarePluginKind('spec-chrome');
	const container = declarePluginKind('spec-chrome-container');
	registerBlockKind(chrome, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	registerBlockKind(container, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: { contract: 'opaque', rebuildRaw: () => {}, reservedChrome: { kind: chrome } }
	});
	return { container, chrome };
}

describe('ensureEditableContainers — reserved-chrome backfill', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('re-mints a chrome leaf + paragraph when a chrome-declaring container empties', () => {
		const { container, chrome } = registerChromeContainer();
		const node: CstNode = { kind: container, leadingTrivia: '', raw: '', children: [] } as CstNode;

		ensureEditableContainers(node);

		expect(node.children?.map((c) => c.kind)).toEqual([chrome, 'paragraph']);
		expect(node.children?.map((c) => c.raw)).toEqual(['\n', '\n']);
		expect(node.innerPrefix).toBe('');
	});

	it('backfills only a bare paragraph for a container with no chrome declaration', () => {
		const plain = declarePluginKind('spec-plain-container');
		registerBlockKind(plain, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		const node: CstNode = { kind: plain, leadingTrivia: '', raw: '', children: [] };

		ensureEditableContainers(node);

		expect(node.children?.map((c) => c.kind)).toEqual(['paragraph']);
		expect(node.innerPrefix).toBe('');
	});
});
