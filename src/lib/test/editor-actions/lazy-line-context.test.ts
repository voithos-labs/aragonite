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

// The line leaves the container it was lazy in: the item or quote at the top, the inner quote two
// deep, where the outer quote's own marker still holds it.
const ROWS: [name: string, source: string, leaf: number[], written: string, after: string][] = [
	['in a list item', '- a\nlazy\n', [0, 0, 0], '# a\nlazy\n', '- # a\nlazy\n'],
	['in a quote', '> a\nlazy\n', [0, 0], '# a\nlazy\n', '> # a\nlazy\n'],
	['two quotes deep', '> > a\n> lazy\n', [0, 0, 0], '# a\nlazy\n', '> > # a\n> lazy\n']
];

/** Every node's kind and children, which the edited tree and its reload must share. */
const kindsOf = (nodes: readonly CstNode[]): unknown[] =>
	nodes.map((node) => [node.kind, kindsOf(node.children ?? [])]);

const toCrlf = (bytes: string): string => bytes.replace(/\n/g, '\r\n');

describe('a heading typed over the line a lazy line continued', () => {
	for (const [routeName, route] of ROUTES) {
		for (const ending of ['LF', 'CRLF'] as const) {
			const mirror = ending === 'LF' ? (bytes: string) => bytes : toCrlf;
			it.each(ROWS)(`%s, ${routeName}, ${ending}`, async (_name, source, leaf, written, after) => {
				const h = makeTopHarness(mirror(source));

				await route(h, leaf, mirror(written));

				expect(serialize(h.deps.doc)).toBe(mirror(after));
				expect(kindsOf(h.deps.doc.children)).toEqual(kindsOf(parse(mirror(after)).children));
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

// Miss-analysis: every lazy row edited the line above the lazy one, so no test rewrote a lazy line
// into one that can't continue, which is the line that has to take the container's prefix.
describe('a lazy line rewritten into a line that no longer continues', () => {
	it.each(ROUTES)('takes the quote’s prefix, %s', async (_name, route) => {
		const h = makeTopHarness('> a\nlazy\n');

		await route(h, [0, 0], 'a\n- lazy\n');

		expect(serialize(h.deps.doc)).toBe('> a\n> - lazy\n');
		expect(kindsOf(h.deps.doc.children)).toEqual(kindsOf(parse('> a\n> - lazy\n').children));
		expect(describeConvergence(h.deps.doc)).toBeNull();
	});

	// The parser asks whether the item's first line keeps its paragraph open with the checkbox
	// still on it, so `# x` behind a checkbox is text a lazy line continues.
	it.each(ROUTES)('stays bare behind a checkbox’s first line, %s', async (_name, route) => {
		const h = makeTopHarness('- [ ] # x\nlazy\n');

		await route(h, [0, 0, 0], '# x\nlazyQ\n');

		expect(serialize(h.deps.doc)).toBe('- [ ] # x\nlazyQ\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
	});
});
