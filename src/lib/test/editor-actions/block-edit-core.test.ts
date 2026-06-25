import { describe, expect, it } from 'vitest';
import { createBlockEditCore } from '$lib/editor-actions/block-edit-core';
import type { CommitScope, ScopeCommitArgs } from '$lib/editor-actions/block-edit-scope';
import { createSharingState } from '$lib/tree-operations/sharing';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';

function leaf(raw: string): CstNode {
	return parse(raw).children[0];
}

/** Stub scope: runs the real mutate against a live children array, records commits. */
function stubScope(children: CstNode[], collapseEmptyReplaceToDelete = true) {
	const commits: ScopeCommitArgs[] = [];
	const sharing = createSharingState();
	const scope: CommitScope = {
		children: () => children,
		refAt: () => undefined,
		collapseEmptyReplaceToDelete,
		async commit(args) {
			commits.push(args);
			args.mutate({
				children,
				sharing,
				unshareChild: (i) => children[i]
			});
		}
	};
	return { scope, commits, children };
}

describe('block-edit core — shared structural decisions', () => {
	it('split at a mid offset produces two blocks and a split op', async () => {
		const { scope, commits, children } = stubScope([leaf('hello world\n')]);
		await createBlockEditCore(scope).split(0, 5);
		expect(children).toHaveLength(2);
		expect(commits[0].op.kind).toBe('split');
		expect(commits[0].op.detail).toEqual({ at: 5 });
		expect(commits[0].eventTarget).toBe(0);
	});

	it('split at offset 0 of a non-empty block bumps trivia without adding a block', async () => {
		const { scope, commits, children } = stubScope([leaf('hello\n')]);
		await createBlockEditCore(scope).split(0, 0);
		expect(children).toHaveLength(1);
		expect(commits[0].op.detail).toEqual({ at: 0 });
	});

	it('merge-prev of two paragraphs is eligible and concatenates', async () => {
		const { scope, commits, children } = stubScope([leaf('a\n'), leaf('b\n')]);
		await createBlockEditCore(scope).mergeWithPreviousInterior(1);
		expect(children).toHaveLength(1);
		expect(children[0].raw).toContain('a');
		expect(children[0].raw).toContain('b');
		expect(commits[0].op.kind).toBe('merge');
		expect(commits[0].op.detail).toEqual({ direction: 'prev' });
	});

	it('merge-next of two paragraphs is eligible and concatenates onto the current block', async () => {
		const { scope, commits, children } = stubScope([leaf('a\n'), leaf('b\n')]);
		await createBlockEditCore(scope).mergeWithNextInterior(0);
		expect(children).toHaveLength(1);
		expect(children[0].raw).toContain('a');
		expect(children[0].raw).toContain('b');
		expect(commits[0].op.kind).toBe('merge');
		expect(commits[0].op.detail).toEqual({ direction: 'next' });
		expect(commits[0].eventTarget).toBe(0);
	});

	it('merge-prev into a non-editable previous block deletes it, targeting the neighbor', async () => {
		const { scope, commits, children } = stubScope([leaf('---\n'), leaf('text\n')]);
		await createBlockEditCore(scope).mergeWithPreviousInterior(1);
		expect(children).toHaveLength(1);
		expect(commits[0].op.kind).toBe('delete');
		// The deleted neighbor (i-1), not i — the not-editable-merge eventPath watch-point.
		expect(commits[0].eventTarget).toBe(0);
	});

	it('merge-next into a non-editable next block deletes it, targeting the neighbor', async () => {
		const { scope, commits, children } = stubScope([leaf('text\n'), leaf('---\n')]);
		await createBlockEditCore(scope).mergeWithNextInterior(0);
		expect(children).toHaveLength(1);
		expect(commits[0].op.kind).toBe('delete');
		expect(commits[0].eventTarget).toBe(1);
	});

	it('merge-prev into an editable-but-unmergeable previous block moves focus without committing', async () => {
		// fencedCode is not-mergeable yet editable, so the prev block is neither
		// concatenated nor deleted — the else branch only moves focus.
		const { scope, commits, children } = stubScope([leaf('```\n'), leaf('text\n')]);
		expect(children[0].kind).toBe('fencedCode');
		await createBlockEditCore(scope).mergeWithPreviousInterior(1);
		expect(children).toHaveLength(2);
		expect(commits).toHaveLength(0);
	});

	it('merge-next into an editable-but-unmergeable next block moves focus without committing', async () => {
		const { scope, commits, children } = stubScope([leaf('text\n'), leaf('```\n')]);
		expect(children[1].kind).toBe('fencedCode');
		await createBlockEditCore(scope).mergeWithNextInterior(0);
		expect(children).toHaveLength(2);
		expect(commits).toHaveLength(0);
	});

	it('deleteInterior removes the block and emits a delete op targeting it', async () => {
		const { scope, commits, children } = stubScope([leaf('a\n'), leaf('b\n')]);
		await createBlockEditCore(scope).deleteInterior(1);
		expect(children).toHaveLength(1);
		expect(children[0].raw).toContain('a');
		expect(commits[0].op.kind).toBe('delete');
		expect(commits[0].eventTarget).toBe(1);
	});

	it('replaceBlock with nodes emits replaceBlock with its count', async () => {
		const rep = stubScope([leaf('x\n')]);
		await createBlockEditCore(rep.scope).replaceBlock(0, [leaf('a\n'), leaf('b\n')]);
		expect(rep.commits[0].op.kind).toBe('replaceBlock');
		expect(rep.commits[0].op.detail).toEqual({ count: 2 });
		expect(rep.children).toHaveLength(2);
	});

	it('empty replaceBlock removes the block but emits a per-scope op-kind', async () => {
		const collapsed = stubScope([leaf('x\n'), leaf('y\n')], true);
		await createBlockEditCore(collapsed.scope).replaceBlock(0, []);
		expect(collapsed.children).toHaveLength(1);
		expect(collapsed.commits[0].op.kind).toBe('delete');

		const labelled = stubScope([leaf('x\n'), leaf('y\n')], false);
		await createBlockEditCore(labelled.scope).replaceBlock(0, []);
		expect(labelled.children).toHaveLength(1);
		expect(labelled.commits[0].op.kind).toBe('replaceBlock');
		expect(labelled.commits[0].op.detail).toEqual({ count: 0 });
	});

	it('updateBlockMetadata merges fields and emits metadataUpdate', async () => {
		const { scope, commits, children } = stubScope([leaf('- [ ] task\n').children![0]]);
		await createBlockEditCore(scope).updateBlockMetadata(0, { taskChecked: true });
		expect(commits[0].op.kind).toBe('metadataUpdate');
		expect(commits[0].op.detail).toEqual({ fields: ['taskChecked'] });
		expect(children[0].metadata).toMatchObject({ taskChecked: true });
	});

	it('updateBlockMetadata with an empty patch is a no-op (no commit)', async () => {
		const { scope, commits } = stubScope([leaf('hello\n')]);
		await createBlockEditCore(scope).updateBlockMetadata(0, {});
		expect(commits).toHaveLength(0);
	});
});
