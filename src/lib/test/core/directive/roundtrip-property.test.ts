import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { rebuildDirectiveContainerRaw } from '$lib/core/directive/kinds';
import { registerDirective, __resetDirectiveRegistryForTests } from '$lib/core/directive/registry';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { roundTripCases } from '$lib/test/support/round-trip';

activateDirectiveGrammar(); // before any parse

const cases = [
	':::note\nbody\n:::\n',
	':::note  Title\n\n**md** body\n\n:::\n',
	'::::outer\n:::inner\nx\n:::\n::::\n',
	':::unregisteredPlugin\nstill lossless\n:::\n',
	':::note\n:::\n',
	':::wide\nx\n::::\n', // pins closerColonCount capture
	':::bare\nx\n:::', // pins closerNewline capture
	'::leaf\n',
	'::toc\n',
	'::embed some info\n',
	'::note-2 x\n',
	'::note keep  \n' // pins verbatim info bytes
];

describe('directive round-trip property', () => {
	roundTripCases(cases);

	it('opens a well-formed :::name as a directive container, not a paragraph', () => {
		expect(parse(':::x\ny\n:::\n').children[0].kind).toBe('directiveContainer');
	});

	it('opens a :: fence as a single-line directive leaf', () => {
		expect(parse('::leaf\n').children[0].kind).toBe('directiveLeaf');
	});
});

// `serialize` emits `node.raw` verbatim, so the property above passes even if the opener
// mis-captures metadata. This pins that the captured fields reconstruct the same bytes.
describe('directive container rebuild is the opener inverse', () => {
	const containerCases = cases.filter((src) => src.startsWith(':::'));
	for (const src of containerCases) {
		it(`reconstructs ${JSON.stringify(src)} from captured fields`, () => {
			const node = parse(src).children[0];
			const before = node.raw;
			rebuildDirectiveContainerRaw(node);
			expect(node.raw).toBe(before);
		});
	}
});

// The dispatch half of the opener: a registered name resolves through the registry to its
// `fromDirective` factory. No case above registers a name, so this is its only exercise.
describe('registered-name dispatch via fromDirective', () => {
	const CHART = declarePluginKind('directiveChartProbe');
	beforeAll(() => {
		registerDirective('container', 'chart', {
			kind: CHART,
			// A factory can build a byte-exact node straight from the contract's
			// `raw` + `leadingTrivia` — no re-derivation through serializeDirective.
			fromDirective: (parsed) => {
				const node: CstNode = {
					kind: CHART,
					leadingTrivia: parsed.leadingTrivia,
					raw: parsed.raw
				};
				return node;
			}
		});
	});
	afterAll(() => __resetDirectiveRegistryForTests());

	it('delegates a registered name to its factory node, not the generic kind', () => {
		expect(parse(':::chart\nx\n:::\n').children[0].kind).toBe('directiveChartProbe');
	});

	it('round-trips a registered directive byte-for-byte', () => {
		const src = ':::chart\nx\n:::\n';
		expect(serialize(parse(src))).toBe(src);
	});
});
