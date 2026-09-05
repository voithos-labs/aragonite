import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';

// Text parsing to MULTIPLE blocks must replace the block with all of them at both levels.
// Cramming the extras into the first node's raw (the stuck-fence class) leaves the live
// CST disagreeing with parse(serialize(doc)).

describe('top-level updateBlockContent with multi-block text', () => {
	it('replaces the block with every parsed block and resyncs ids/refs', async () => {
		const h = makeTopHarness('foo\n');
		await h.actions.updateBlockContent(0, 'foo\\\n# bar\n', 3, 8);
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading']);
		expect(h.deps.doc.children[0].raw).toBe('foo\\\n');
		expect(h.getBlockIds()).toHaveLength(2);
		expect(h.getBlockRefs()).toHaveLength(2);
		expect(h.getBlockIds()[0]).toBe('block-0');
		expect(serialize(h.deps.doc)).toBe('foo\\\n# bar\n');
	});

	it('same-kind multi-block text splits too (the stuck-fence shape)', async () => {
		const h = makeTopHarness('```\nx\n```\n');
		await h.actions.updateBlockContent(0, '```\nx\n```\n\nhello\n', 9, 16);
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'paragraph']);
		expect(h.deps.doc.children[0].raw).toBe('```\nx\n```\n');
		expect(h.getBlockIds()).toHaveLength(2);
	});

	it('emits one updateContent edit at the block and snapshots for one-step undo', async () => {
		const h = makeTopHarness('foo\n');
		await h.actions.updateBlockContent(0, 'foo\\\n# bar\n', 3);
		const update = h.edits.find((e) => e.op === 'updateContent');
		expect(update).toBeDefined();
		expect(update!.path).toEqual([0]);
		const top = h.deps.undoManager.peekUndo();
		expect(top?.snapshot.children).toHaveLength(1);
		expect(top?.snapshot.children[0].raw).toBe('foo\n');
	});

	it('routine same-kind single-block typing is unchanged (no structural commit)', async () => {
		const h = makeTopHarness('foo\n');
		const before = h.getBlockIds();
		await h.actions.updateBlockContent(0, 'foob\n', 3, 4);
		expect(h.deps.doc.children).toHaveLength(1);
		expect(h.deps.doc.children[0].raw).toBe('foob\n');
		expect(h.getBlockIds()).toBe(before);
	});
});

describe('nested updateBlockContent with multi-block text', () => {
	it('grows the container with every parsed block, childIds synced, raw rebuilt', async () => {
		const h = makeNestedHarness('> foo\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, 'foo\\\n# bar\n', 3);
		const bq = h.deps.doc.children[0];
		expect(bq.children!.map((c) => c.kind)).toEqual(['paragraph', 'heading']);
		expect(bq.children![0].raw).toBe('foo\\\n');
		expect(bq.childIds).toHaveLength(2);
		expect(bq.raw).toBe('> foo\\\n> # bar\n');
	});
});
