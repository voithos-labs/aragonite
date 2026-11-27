// @vitest-environment jsdom
// The fence the range core reads agrees with the body each fenced kind declares (`bodyRange`), on
// fence lines and on one line, closed or left open, in either line ending.
// Miss-analysis: the core read fences off the grammar alone while the kinds declared their bodies
// apart, so the one-line `$$x^2$$` had a body and no fence, and nothing compared the two.
import { expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { NodeView } from '#lib/core/node-views.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { checkHost, testReading } from './test-host';

const F = '```';
const DOCUMENTS = [
	'$$x^2$$\n',
	'$$\nx^2\n$$\n',
	'$$\nx^2\n',
	`${F}js\nx\n${F}\n`,
	`${F}math\nx^2\n${F}\n`,
	`${F}mermaid\ngraph TD\n${F}\n`,
	'~~~\na\n\nb\n~~~\n',
	`${F}\nopen\n`,
	'> $$x^2$$\n',
	'- $$\n  x\n  $$\n'
];

function* leaves(nodes: readonly NodeView[]): Generator<NodeView> {
	for (const node of nodes) {
		if (node.children?.length) yield* leaves(node.children);
		else yield node;
	}
}

it('every fenced leaf’s fence spans the body its kind declares', () => {
	const reading = testReading();
	const host = checkHost(reading);
	const out: string[] = [];
	const kinds = new Set<string>();
	for (const text of DOCUMENTS.flatMap((d) => [d, d.replace(/\n/g, '\r\n')])) {
		for (const node of leaves(parse(text, { grammar: reading.grammar }).children)) {
			const declared = tryGetBlockKindDescriptor(node.kind)?.bodyRange?.(node);
			if (!declared || host.facts(node.kind).body !== 'literal') continue;
			kinds.add(node.kind);
			const fence = host.fence(node);
			const got = fence && { start: fence.body, end: fence.end };
			if (JSON.stringify(got) !== JSON.stringify(declared))
				out.push(
					`${JSON.stringify(node.raw)}: fence ${JSON.stringify(got)}, body ${JSON.stringify(declared)}`
				);
		}
	}
	expect([...kinds].sort()).toEqual(['fencedCode', 'latex/block', 'mermaid/diagram']);
	expect(out).toEqual([]);
});
