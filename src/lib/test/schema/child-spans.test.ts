// The hand-built edges of the one-child splice: what each kind's per-line syntax does to a
// region, and the two shapes where the rebuild must refuse the splice and re-derive instead.
import { describe, it, expect } from 'vitest';
import { makeBlockNode, type BlockMetadata, type CstNode } from '$lib/core/nodes';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { pushChild, spliceChildren } from '$lib/tree-operations/children';
import { reorderChildren } from '$lib/tree-operations/reorder';

const paragraph = (raw: string, leadingTrivia = ''): CstNode =>
	makeBlockNode({ kind: 'paragraph', leadingTrivia, raw });

const LIST_ITEM_META = (marker: string, taskMarker: string | null = null): BlockMetadata => ({
	marker,
	taskItem: taskMarker !== null,
	taskChecked: false,
	taskMarker
});

function container(
	kind: 'list' | 'listItem' | 'blockquote',
	children: CstNode[],
	extra: { metadata?: BlockMetadata; innerSuffix?: string } = {}
): CstNode {
	const node = makeBlockNode({
		kind,
		leadingTrivia: '',
		raw: '',
		metadata: extra.metadata ?? (kind === 'list' ? { ordered: false } : { quoteDepth: 1 }),
		children,
		innerSuffix: extra.innerSuffix
	});
	rebuild(node);
	return node;
}

function rebuild(node: CstNode, changed?: { index: number; previousRaw: string }): void {
	getBlockKindDescriptor(node.kind).rebuildRaw!(node, changed);
}

/** Rewrite one child's raw and rebuild through the hint, as the typing door does. */
function rewriteChild(node: CstNode, index: number, raw: string): void {
	const previousRaw = node.children![index].raw;
	node.children![index].raw = raw;
	rebuild(node, { index, previousRaw });
}

const spans = (node: CstNode): number[] | undefined =>
	node.childSpans ? Array.from(node.childSpans) : undefined;

describe('the spliced region carries each kind’s own syntax', () => {
	it('re-quotes only the rewritten child, CRLF included', () => {
		const node = container('blockquote', [
			paragraph('a\r\n'),
			paragraph('b\r\n'),
			paragraph('c\r\n')
		]);
		expect(node.raw).toBe('> a\r\n> b\r\n> c\r\n');
		rewriteChild(node, 1, 'bb\r\nbbb\r\n');
		expect(node.raw).toBe('> a\r\n> bb\r\n> bbb\r\n> c\r\n');
		expect(spans(node)).toEqual([0, 5, 5, 18, 18, 23]);
	});

	it('keeps the marker on the first child and the indent under a wide one', () => {
		const node = container('listItem', [paragraph('one\n'), paragraph('two\n')], {
			metadata: LIST_ITEM_META('100. ')
		});
		expect(node.raw).toBe('100. one\n     two\n');
		rewriteChild(node, 1, 'two\nthree\n');
		expect(node.raw).toBe('100. one\n     two\n     three\n');
		rewriteChild(node, 0, 'first\n');
		expect(node.raw).toBe('100. first\n     two\n     three\n');
	});

	it('leaves a blank body line unindented and keeps the task marker', () => {
		const node = container('listItem', [paragraph('one\n'), paragraph('\n'), paragraph('two\n')], {
			metadata: LIST_ITEM_META('- ', '[x] ')
		});
		expect(node.raw).toBe('- [x] one\n\n  two\n');
		rewriteChild(node, 2, 'edited\n');
		expect(node.raw).toBe('- [x] one\n\n  edited\n');
	});

	it('splices a list child whose bytes end without a line ending', () => {
		const node = container('list', [paragraph('- a\n'), paragraph('- b')]);
		rewriteChild(node, 1, '- bb');
		expect(node.raw).toBe('- a\n- bb');
		expect(spans(node)).toEqual([0, 4, 4, 8]);
	});

	it('keeps an inner suffix behind the last child’s region', () => {
		const node = container('blockquote', [paragraph('a\n'), paragraph('b\n')], {
			innerSuffix: '\n'
		});
		expect(node.raw).toBe('> a\n> b\n>\n');
		rewriteChild(node, 1, 'bb\n');
		expect(node.raw).toBe('> a\n> bb\n>\n');
	});
});

describe('the rebuild refuses a splice it cannot place', () => {
	// Line 0 belongs to whichever child first carries one: filling an empty opening child moves
	// the marker off the child that had it, which no single-region rewrite can express.
	it('re-derives when the emptied opening child takes back the first line', () => {
		const node = container('listItem', [paragraph(''), paragraph('text\n')], {
			metadata: LIST_ITEM_META('- ')
		});
		expect(node.raw).toBe('- text\n');
		rewriteChild(node, 0, 'x\n');
		expect(node.raw).toBe('- x\n  text\n');
	});

	// A reorder mutates a bare children array, which has no owner to drop spans on: the region
	// check is the whole defense, and without it the moved child's region is written twice.
	it('re-derives after a reorder no seam could invalidate for it', () => {
		const node = container('blockquote', [paragraph('a\n'), paragraph('bbbb\n')]);
		expect(node.raw).toBe('> a\n> bbbb\n');
		reorderChildren(node.children!, 1, 0);
		rewriteChild(node, 0, 'bbbbb\n');
		expect(node.raw).toBe('> bbbbb\n> a\n');
	});
});

describe('the children doors drop the spans they invalidate', () => {
	it('drops on a splice and on a push', () => {
		const node = container('blockquote', [paragraph('a\n'), paragraph('b\n')]);
		// Typed, not a plain array: Svelte proxies those, and the shift would mint a source per
		// element — the O(children) cost the spans exist to remove (`schema/child-spans.ts`).
		expect(node.childSpans).toBeInstanceOf(Uint32Array);
		expect(spans(node)).toEqual([0, 4, 4, 8]);
		spliceChildren(node, 1, 1, paragraph('c\n'));
		expect(node.childSpans).toBeUndefined();
		rebuild(node);
		pushChild(node, paragraph('d\n'));
		expect(node.childSpans).toBeUndefined();
		rebuild(node);
		expect(node.raw).toBe('> a\n> c\n> d\n');
	});
});
