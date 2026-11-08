import { describe, it, expect } from 'vitest';
import { checkOpaqueRebuildDeterminism } from '../../invariants/node-shape';
import { testContainer, testLeaf } from '#lib/test/harness/test-kinds.js';
import { fencedLines } from '#lib/schema/fenced-lines.js';
import { concatChildren } from '../../core/serializer';
import { setPluginMetadata, getPluginMetadata, type CstNode } from '../../core/nodes';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

describe('checkOpaqueRebuildDeterminism (opaque containers)', () => {
	function opaqueNode(kind: CstNode['kind']): CstNode {
		return {
			kind,
			leadingTrivia: '',
			raw: '::x \nbody\n::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		} as CstNode;
	}

	// The node's raw is deliberately non-canonical relative to the rebuilder:
	// the two rebuild outputs are compared to each other, never to node.raw.
	it('passes for a deterministic rebuilder even when its output differs from raw', () => {
		const kind = testContainer('spec-det', {
			rebuildRaw: (node) => {
				node.raw = `::x\n${concatChildren(node.children ?? [])}::\n`;
			}
		});
		expect(checkOpaqueRebuildDeterminism(opaqueNode(kind), defaultGrammarView)).toBeNull();
	});

	it('fires for a rebuilder whose output varies over identical committed state', () => {
		let calls = 0;
		const kind = testContainer('spec-nondet', {
			rebuildRaw: (node) => {
				node.raw = `::x ${calls++}\n::\n`;
			}
		});
		expect(checkOpaqueRebuildDeterminism(opaqueNode(kind), defaultGrammarView)?.code).toBe(
			'opaque-rebuild-nondeterministic'
		);
	});

	// The writer is the container writer's for a kind with a line shape, so the check has to run it.
	it('fires for a line shape whose written lines vary over identical committed state', () => {
		let calls = 0;
		const kind = testLeaf('spec-shape-nondet', {
			mergeRole: 'container',
			container: { lines: fencedLines({ open: () => [`::x ${calls++}`], close: () => '::' }) }
		});
		expect(checkOpaqueRebuildDeterminism(opaqueNode(kind), defaultGrammarView)?.code).toBe(
			'opaque-rebuild-nondeterministic'
		);
	});

	it('shields the live node from a misbehaving rebuilder', () => {
		const kind = testContainer('spec-misbehaved', {
			rebuildRaw: (node) => {
				node.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: 'INJECTED\n' });
				getPluginMetadata<{ tone: string }>(node)!.tone = 'hacked';
				node.raw = '::x\n::\n';
			}
		});
		const node = opaqueNode(kind);
		setPluginMetadata(node, { tone: 'calm' });

		checkOpaqueRebuildDeterminism(node, defaultGrammarView);

		expect(node.raw).toBe('::x \nbody\n::\n');
		expect(node.children).toHaveLength(1);
		expect(getPluginMetadata<{ tone: string }>(node)?.tone).toBe('calm');
	});
});
