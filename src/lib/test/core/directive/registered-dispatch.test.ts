import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseInline } from '$lib/core/inline';
import { declarePluginKind, declarePluginInlineKind } from '$lib/schema/plugin-kind';
import { registerDirective, __resetDirectiveRegistryForTests } from '$lib/core/directive/registry';
import { DIRECTIVE_LEAF, DIRECTIVE_TEXT } from '$lib/core/directive/kinds';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';

activateDirectiveGrammar(); // before any parse

// Sibling-path parity: the leaf and text tiers must dispatch a registered name exactly as
// the container tier does (pinned in roundtrip-property.test.ts).

const CUSTOM_LEAF = declarePluginKind('directiveCustomLeafProbe');
const FACTORY_LEAF = declarePluginKind('directiveFactoryLeafProbe');
const GLOSS = declarePluginInlineKind('directiveGlossProbe');

beforeAll(() => {
	registerDirective('leaf', 'customleaf', { kind: CUSTOM_LEAF });
	registerDirective('leaf', 'factoryleaf', {
		kind: FACTORY_LEAF,
		fromDirective: (parsed) =>
			({ kind: FACTORY_LEAF, leadingTrivia: parsed.leadingTrivia, raw: parsed.raw }) as CstNode
	});
	registerDirective('text', 'gloss', { kind: GLOSS });
});
afterAll(() => __resetDirectiveRegistryForTests());

describe('leaf tier registered dispatch', () => {
	it('stamps a kind-only registration on the leaf node, not directiveLeaf', () => {
		expect(parse('::customleaf info\n').children[0].kind).toBe('directiveCustomLeafProbe');
	});

	it('delegates to a fromDirective factory when one is registered', () => {
		expect(parse('::factoryleaf x\n').children[0].kind).toBe('directiveFactoryLeafProbe');
	});

	it('round-trips a registered leaf byte-for-byte', () => {
		for (const src of ['::customleaf info\n', '::factoryleaf x\n']) {
			expect(serialize(parse(src))).toBe(src);
		}
	});

	it('leaves an unregistered :: name as the generic directiveLeaf', () => {
		expect(parse('::toc\n').children[0].kind).toBe(DIRECTIVE_LEAF);
	});
});

describe('text tier registered dispatch', () => {
	it('stamps the registered kind on a matched :name[label] span, not directiveText', () => {
		const src = 'see :gloss[HTML] here';
		const nodes = parseInline(src, 0, src.length);
		const directive = nodes.find((n) => n.kind === GLOSS);
		expect(directive).toBeDefined();
		expect(src.slice(directive!.start, directive!.end)).toBe(':gloss[HTML]');
		expect(nodes.some((n) => n.kind === DIRECTIVE_TEXT)).toBe(false);
	});

	it('round-trips a registered text directive byte-for-byte', () => {
		const src = 'see :gloss[HTML] here';
		expect(serialize(parse(src))).toBe(src);
	});

	it('leaves an unregistered :name[label] as the generic directiveText', () => {
		const nodes = parseInline(':x[y] z', 0, 7);
		const directive = nodes.find((n) => n.kind === DIRECTIVE_TEXT);
		expect(directive).toMatchObject({ start: 0, end: 5 });
		expect(nodes.some((n) => n.kind === GLOSS)).toBe(false);
	});
});
