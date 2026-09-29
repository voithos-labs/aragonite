// G1.44: the check fails an empty document and an emptied container that must hold a child, and
// the commit runs it on what it touched.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { checkKeepsABlock } from '$lib/invariants/keeps-a-block';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { asDocPath } from '$lib/selection/path-math';
import { makeBlockListState, makeTopHarness } from '../harness/editor-actions';
import { takeDevWarns } from '../support/warn-gate';

/** `bytes` parsed, and the quote at `index` emptied, as a removal with no cleanup leaves it. */
function emptiedQuote(bytes: string, index = 0): { doc: Document; quote: CstNode } {
	const doc = parse(bytes);
	const quote = doc.children[index];
	quote.children = [];
	return { doc, quote };
}

describe('G1.44 checkKeepsABlock', () => {
	beforeEach(registerMermaidKind);

	it('fails a document with no block', () => {
		expect(checkKeepsABlock(parse(''), [])?.message).toMatch(/document holds no block/);
	});

	it('fails a touched quote with no children', () => {
		const { doc, quote } = emptiedQuote('> a\n\nb\n');
		expect(checkKeepsABlock(doc, [quote])?.message).toMatch(/blockquote holds no block/);
	});

	it.each([
		['a document and a touched quote that each hold a block', '> a\n', [0]],
		['a touched diagram, which holds no child by design', '```mermaid\ngraph TD\n```\n', [0]],
		['a touched paragraph', 'a\n', [0]]
	])('passes %s', (_name, bytes, touched) => {
		const doc = parse(bytes);
		expect(
			checkKeepsABlock(
				doc,
				touched.map((i) => doc.children[i])
			)
		).toBeNull();
	});
});

describe('G1.44 at the commit', () => {
	it('a container commit that empties its quote reports it', async () => {
		const h = makeTopHarness('> a\n\nb\n');
		const quote = h.deps.doc.children[0];
		await h.controller.commitContainerStructural({
			containerNode: quote,
			path: [0],
			state: makeBlockListState(() => h.deps.doc.children[0]),
			snapshot: { path: asDocPath([0, 0]), offset: 0 },
			mutate: (scope) => {
				scope.children.splice(0, 1);
				return { op: 'delete', at: 0, count: 1 };
			},
			op: { kind: 'delete', eventPath: asDocPath([0, 0]) }
		});
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:keeps-a-block');
	});

	it('a document commit that installs an empty quote reports it', async () => {
		const h = makeTopHarness('a\n\nb\n');
		const emptyQuote = { ...parse('> a\n').children[0], children: [] } as CstNode;
		await h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (children) => {
				children.splice(0, 1, emptyQuote);
				return { op: 'replace', at: 0, count: 1, newCount: 1 };
			},
			op: { kind: 'replaceBlock', detail: { count: 1 }, eventPath: asDocPath([0]) }
		});
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:keeps-a-block');
	});
});
