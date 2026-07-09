import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rebuildDirectiveContainerRaw } from '$lib/core/directive/kinds';
import '$lib/core/directive/register'; // side-effect activation of the directive grammar

const cases = [
	':::note\nbody\n:::\n',
	':::note  Title\n\n**md** body\n\n:::\n',
	'::::outer\n:::inner\nx\n:::\n::::\n', // nested, colon-count aware
	':::unregisteredPlugin\nstill lossless\n:::\n', // generic fallback
	':::note\n:::\n', // empty body
	'::leaf\n' // leaf tier — a single-line directive node
];

describe('directive round-trip property', () => {
	for (const src of cases) {
		it(`round-trips ${JSON.stringify(src)}`, () => {
			expect(serialize(parse(src))).toBe(src);
		});
	}

	it('opens a well-formed :::name as a directive container, not a paragraph', () => {
		expect(parse(':::x\ny\n:::\n').children[0].kind).toBe('directiveContainer');
	});

	it('opens a :: fence as a single-line directive leaf', () => {
		expect(parse('::leaf\n').children[0].kind).toBe('directiveLeaf');
	});

	// The block parser resolves code fences (priority 10) before the directive
	// opener (45), so a `:::` inside a code block stays code, not a directive.
	it('does not claim a ::: fence inside a fenced code block', () => {
		const src = '```\n:::note\n```\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).toBe('fencedCode');
	});
});

// The opaque contract makes `serialize` emit `node.raw` verbatim, so the property
// above passes even if the opener mis-captures metadata/children. This pins that
// the captured fields reconstruct the same bytes — the post-edit gate.
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
