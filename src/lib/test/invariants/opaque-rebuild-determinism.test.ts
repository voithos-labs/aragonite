import { describe, it, expect, beforeEach } from 'vitest';
import { checkOpaqueRebuildDeterminism } from '../../invariants/node-shape';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { concatChildren } from '../../core/serializer';
import { setPluginMetadata, getPluginMetadata, type CstNode } from '../../core/nodes';

describe('checkOpaqueRebuildDeterminism (opaque containers)', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	function registerOpaque(name: string, rebuildRaw: (node: CstNode) => void) {
		const kind = declarePluginKind(name);
		registerBlockKind(kind, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'opaque', rebuildRaw }
		});
		return kind;
	}

	function opaqueNode(kind: CstNode['kind']): CstNode {
		return {
			kind,
			leadingTrivia: '',
			raw: '::x \nbody\n::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		} as CstNode;
	}

	// The node's raw is deliberately non-canonical relative to the rebuilder —
	// the two probe outputs are compared to each other, never to node.raw.
	it('passes for a deterministic rebuilder even when its output differs from raw', () => {
		const kind = registerOpaque('spec-det', (node) => {
			node.raw = `::x\n${concatChildren(node.children ?? [])}::\n`;
		});
		expect(checkOpaqueRebuildDeterminism(opaqueNode(kind))).toBeNull();
	});

	it('fires for a rebuilder whose output varies over identical committed state', () => {
		let calls = 0;
		const kind = registerOpaque('spec-nondet', (node) => {
			node.raw = `::x ${calls++}\n::\n`;
		});
		expect(checkOpaqueRebuildDeterminism(opaqueNode(kind))?.code).toBe(
			'opaque-rebuild-nondeterministic'
		);
	});

	it('shields the live node from a misbehaving rebuilder', () => {
		const kind = registerOpaque('spec-misbehaved', (node) => {
			node.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: 'INJECTED\n' });
			getPluginMetadata<{ tone: string }>(node)!.tone = 'hacked';
			node.raw = '::x\n::\n';
		});
		const node = opaqueNode(kind);
		setPluginMetadata(node, { tone: 'calm' });

		checkOpaqueRebuildDeterminism(node);

		expect(node.raw).toBe('::x \nbody\n::\n');
		expect(node.children).toHaveLength(1);
		expect(getPluginMetadata<{ tone: string }>(node)?.tone).toBe('calm');
	});
});
