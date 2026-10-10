// Miss-analysis: the opaque stale-raw check compared kind and children with the reparse, never
// metadata, so a rebuild that left a fence count behind its bytes passed every dev build.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins, parse } from '#lib';
import { getPluginMetadata, setPluginMetadata } from '#lib/plugin.js';
import { checkOpaqueStaleRaw } from '#lib/invariants/node-shape.js';
import { getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { registerMermaidKind, type MermaidMetadata } from '#lib/plugins/mermaid/mermaid-kind.js';

beforeEach(() => {
	installPlugins([admonitionsPlugin()]);
	registerMermaidKind();
});

describe('the opaque stale-raw check compares metadata with the reparse (#640)', () => {
	// A bare `rebuildRaw` is a rebuild outside every route that re-reads the metadata.
	it.each([
		['a directive with no title', ':::spoiler\nhidden\n:::\n', 0],
		['a directive with a title', ':::note Heads up\nbody\n:::\n', 1]
	])('fires on %s whose bare rebuild lengthened the fence', (_label, source, bodyIndex) => {
		const node = parse(source).children[0];
		node.children![bodyIndex].raw = node.children![bodyIndex].raw + ':::\n';
		getBlockKindDescriptor(node.kind).rebuildRaw!(node);

		const violation = checkOpaqueStaleRaw(node, defaultGrammarView);
		expect(violation?.code).toBe('opaque-stale-raw');
		expect(violation?.detail).toMatchObject({ reason: 'metadata-diverges' });
		expect(violation?.message).toContain('.colonCount: live 3 != reparsed 4');
	});

	it('fires on a childless container whose metadata its bytes no longer produce', () => {
		const node = parse('```mermaid\ngraph TD\n```\n').children[0];
		setPluginMetadata<MermaidMetadata>(node, {
			...getPluginMetadata<MermaidMetadata>(node)!,
			fenceLength: 4
		});

		expect(checkOpaqueStaleRaw(node, defaultGrammarView)?.message).toContain(
			'mermaid.fenceLength: live 4 != reparsed 3'
		);
	});

	it('stays silent on a freshly parsed container', () => {
		const node = parse(':::spoiler\nhidden\n:::\n').children[0];
		expect(checkOpaqueStaleRaw(node, defaultGrammarView)).toBeNull();
	});
});
