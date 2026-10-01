// A lazy line keeps its bytes, and once an edit ends the paragraph it continued, the tree takes the
// reading a reload gives those bytes.
// Miss-analysis: every rebuild re-prefixed a lazy line, so no test had a kept lazy line lose the
// paragraph it continued, and nothing asked what the bytes then read as.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { documentLineEnding } from '$lib/core/lines';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { commitLeafTextAt } from '$lib/editor-actions/block-edit-core';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import { makeTopHarness, type TopHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

type Route = (h: TopHarness, leaf: number[], text: string) => Promise<void>;

const ROUTES: [string, Route][] = [
	[
		'typed in place',
		async (h, leaf, text) => {
			const owner = blockNodeAt(h.deps.doc, leaf.slice(0, -1)) as CstNode;
			const body = { children: owner.children!, owner, lineEnding: documentLineEnding(h.deps.doc) };
			const write = legalizeWrite(body, leaf[leaf.length - 1], text, 'authored');
			const typing = createLeafTyping(h.deps, h.controller);
			expect(typing.writeLeafInPlace(docPathFrom(leaf), write, 2).wrote).toBe(true);
		}
	],
	[
		'committed',
		async (h, leaf, text) => {
			const result = await commitLeafTextAt(h, leaf, text, { snapshotOffset: 0, caret: 2 });
			expect(result.wrote).toBe(true);
		}
	]
];

const ROWS: [name: string, source: string, leaf: number[], written: string, after: string][] = [
	['in a list item', '- a\nlazy\n', [0, 0, 0], '# a\nlazy\n', '- # a\nlazy\n'],
	['in a quote', '> a\nlazy\n', [0, 0], '# a\nlazy\n', '> # a\nlazy\n'],
	['two quotes deep', '> > a\nlazy\n', [0, 0, 0], '# a\nlazy\n', '> > # a\nlazy\n']
];

const toCrlf = (bytes: string): string => bytes.replace(/\n/g, '\r\n');

describe('a heading typed over the line a lazy line continued', () => {
	for (const [routeName, route] of ROUTES) {
		for (const ending of ['LF', 'CRLF'] as const) {
			const mirror = ending === 'LF' ? (bytes: string) => bytes : toCrlf;
			it.each(ROWS)(`%s, ${routeName}, ${ending}`, async (_name, source, leaf, written, after) => {
				const h = makeTopHarness(mirror(source));

				await route(h, leaf, mirror(written));

				expect(serialize(h.deps.doc)).toBe(mirror(after));
				expect(h.deps.doc.children.map((block) => block.kind)).toEqual(
					parse(mirror(after)).children.map((block) => block.kind)
				);
				expect(h.deps.doc.children).toHaveLength(2);
				expect(describeConvergence(h.deps.doc)).toBeNull();
			});
		}
	}

	it('a lazy line still continuing its paragraph stays in the container', async () => {
		const h = makeTopHarness('> a\nlazy\n');

		await ROUTES[0][1](h, [0, 0], 'ab\nlazy\n');

		expect(serialize(h.deps.doc)).toBe('> ab\nlazy\n');
		expect(h.deps.doc.children).toHaveLength(1);
	});
});
