import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createBlockEditCore } from '$lib/editor-actions/block-edit-core';
import type { CommitScope, ScopeCommitArgs } from '$lib/editor-actions/block-edit-scope';
import { createSharingState } from '$lib/tree-operations/sharing';
import type { CstNode } from '$lib/core/nodes';
import { CURSOR_EXACT_START, CURSOR_START, type BlockComponent } from '$lib/block-component';
import { parse } from '$lib/core/parser';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { testClosure } from '$lib/test/support/closure';
import { takeDevWarns } from '$lib/test/support/warn-gate';

function leaf(raw: string): CstNode {
	return parse(raw).children[0];
}

function focusSpy() {
	const calls: number[] = [];
	const ref = { focus: (offset: number) => calls.push(offset) } as unknown as BlockComponent;
	return { calls, ref };
}

/** Runs the REAL mutate against a live children array, recording commits. */
function stubScope(
	children: CstNode[],
	collapseEmptyReplaceToDelete = true,
	refs: (BlockComponent | undefined)[] = [],
	owner?: CstNode
) {
	const commits: ScopeCommitArgs[] = [];
	const sharing = createSharingState();
	const scope: CommitScope = {
		children: () => children,
		refAt: (i) => refs[i],
		collapseEmptyReplaceToDelete,
		async commit(args) {
			commits.push(args);
			args.mutate({
				children,
				sharing,
				ownerKind: owner?.kind,
				owner,
				getPresentationMode: undefined,
				linkRef: undefined,
				unshareChild: (i) => children[i]
			});
			await args.afterTick?.();
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

	it('split at offset 0 puts an empty block above and keeps the caret on the content', async () => {
		const content = focusSpy();
		const { scope, commits, children } = stubScope([leaf('hello\n')], true, [
			undefined,
			content.ref
		]);
		await createBlockEditCore(scope).split(0, 0);
		expect(children).toHaveLength(2);
		expect(children[0].raw).toBe('\n');
		expect(children[0].kind).toBe('paragraph');
		expect(children[1].raw).toBe('hello\n');
		expect(commits[0].op.kind).toBe('split');
		expect(commits[0].op.detail).toEqual({ at: 0 });
		expect(content.calls).toEqual([CURSOR_EXACT_START]);
	});

	// Miss-analysis (GH #98): the split pins asserted block layout, never where the caret
	// landed; the one focus assertion used a single-block first half, where i + 1 is right.
	it('a split whose first half reparses plural seats the caret on the second half', async () => {
		// Enter at the end of a blank line inside indented code: the first half parses to
		// [code, blank], so the second half sits at i + 2.
		const secondHalf = focusSpy();
		const firstHalfTail = focusSpy();
		const { scope, children } = stubScope([leaf('    a\n\n\n    b\n')], true, [
			undefined,
			firstHalfTail.ref,
			secondHalf.ref
		]);
		await createBlockEditCore(scope).split(0, 7);
		expect(children.map((c) => c.raw)).toEqual(['    a\n', '\n', '    b\n']);
		expect(secondHalf.calls).toEqual([CURSOR_EXACT_START]);
		expect(firstHalfTail.calls).toEqual([]);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['tree-ops']);
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

	it('merge-prev into an editable-but-unmergeable previous block moves focus without committing', async () => {
		// fencedCode is the not-mergeable-yet-editable fixture: the else branch only moves focus.
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

// The whole-block-focus branch sits before the `!isBlockEditable` check, so the policy
// overrides the delete-non-editable fallback regardless of editability. Both merge
// directions are pinned because the bug class here is sibling-path parity.
describe('block-edit core — whole-block-focus fallback', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	function wholeBlockNode(editable: boolean): CstNode {
		const kind = declarePluginKind('spec-whole-block');
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable,
			supportsInline: false,
			closure: testClosure,
			blockFocus: 'whole-block'
		});
		return { kind, leadingTrivia: '', raw: 'diagram\n', children: [] };
	}

	it('merge-prev focuses a non-editable whole-block previous block instead of deleting it', async () => {
		const focus = focusSpy();
		const { scope, commits, children } = stubScope([wholeBlockNode(false), leaf('text\n')], true, [
			focus.ref,
			undefined
		]);
		await createBlockEditCore(scope).mergeWithPreviousInterior(1);
		expect(children).toHaveLength(2);
		expect(commits).toHaveLength(0);
		expect(focus.calls).toEqual([0]);
	});

	it('merge-next focuses a non-editable whole-block next block instead of deleting it', async () => {
		const focus = focusSpy();
		const { scope, commits, children } = stubScope([leaf('text\n'), wholeBlockNode(false)], true, [
			undefined,
			focus.ref
		]);
		await createBlockEditCore(scope).mergeWithNextInterior(0);
		expect(children).toHaveLength(2);
		expect(commits).toHaveLength(0);
		expect(focus.calls).toEqual([0]);
	});

	it('merge-prev into an editable whole-block block (mermaid) focuses it at 0, not CURSOR_END', async () => {
		const focus = focusSpy();
		const { scope, commits, children } = stubScope([wholeBlockNode(true), leaf('text\n')], true, [
			focus.ref,
			undefined
		]);
		await createBlockEditCore(scope).mergeWithPreviousInterior(1);
		expect(children).toHaveLength(2);
		expect(commits).toHaveLength(0);
		expect(focus.calls).toEqual([0]);
	});
});

// The delete-the-neighbour fallback needs a synthetic kind: every non-editable
// built-in is a whole-block-focus target, so only a plugin kind still reaches it.
describe('block-edit core — non-editable neighbour fallback', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	function inertNode(): CstNode {
		const kind = declarePluginKind('spec-inert-leaf');
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable: false,
			supportsInline: false,
			closure: testClosure
		});
		return { kind, leadingTrivia: '', raw: 'inert\n' };
	}

	it('merge-prev deletes the non-editable previous block, targeting the neighbor', async () => {
		const { scope, commits, children } = stubScope([inertNode(), leaf('text\n')]);
		await createBlockEditCore(scope).mergeWithPreviousInterior(1);
		expect(children).toHaveLength(1);
		expect(commits[0].op.kind).toBe('delete');
		// The deleted neighbor (i-1), not i — both scope factories mint the emitted event
		// path from this target (top-level parity in top-level-event-paths.test.ts).
		expect(commits[0].eventTarget).toBe(0);
	});

	it('merge-next deletes the non-editable next block, targeting the neighbor', async () => {
		const { scope, commits, children } = stubScope([leaf('text\n'), inertNode()]);
		await createBlockEditCore(scope).mergeWithNextInterior(0);
		expect(children).toHaveLength(1);
		expect(commits[0].op.kind).toBe('delete');
		expect(commits[0].eventTarget).toBe(1);
	});
});

// The shipped built-in on the same model, deliberately not a synthetic kind: the point
// is that thematicBreak's own descriptor carries the declaration its closure cells claim.
describe('block-edit core — thematicBreak focus-then-delete', () => {
	const rule = () => leaf('---\n');

	it('merge-prev focuses the rule above instead of deleting it', async () => {
		const focus = focusSpy();
		const { scope, commits, children } = stubScope([rule(), leaf('text\n')], true, [
			focus.ref,
			undefined
		]);
		await createBlockEditCore(scope).mergeWithPreviousInterior(1);
		expect(children).toHaveLength(2);
		expect(commits).toHaveLength(0);
		expect(focus.calls).toEqual([0]);
	});

	it('merge-next focuses the rule below instead of deleting it', async () => {
		const focus = focusSpy();
		const { scope, commits, children } = stubScope([leaf('text\n'), rule()], true, [
			undefined,
			focus.ref
		]);
		await createBlockEditCore(scope).mergeWithNextInterior(0);
		expect(children).toHaveLength(2);
		expect(commits).toHaveLength(0);
		expect(focus.calls).toEqual([0]);
	});
});

// Miss-analysis: the wrap-settle pins called the tree op with the container node directly;
// the core's sinks hand the commit view's shape, whose owner no pin ever asserted.
describe('block-edit core — wrap-owner threading', () => {
	beforeEach(() => {
		// registerChromeLeaf registers a paste surface, so the schema reset alone would leave
		// it orphaned and a re-register would collide.
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});
	afterEach(__resetSchemaRegistriesForTests);

	it('deleteInterior hands the owner to the settle, so the wrap absorbs the freed line', async () => {
		const doc = parse(':::callout\nA\n\nB\n:::\n');
		const callout = doc.children[0];
		const { scope, children } = stubScope(callout.children!, true, [], callout);

		await createBlockEditCore(scope).deleteInterior(1);

		expect(children.map((c) => c.leadingTrivia + c.raw).join('')).not.toContain('A');
		expect(callout.innerPrefix).toBe('\n');
	});
});

describe('block-edit core — chrome.descendToBody', () => {
	it('focuses the existing body sibling without minting or committing', async () => {
		const body = focusSpy();
		const { scope, commits, children } = stubScope([leaf('Title\n'), leaf('Body\n')], true, [
			undefined,
			body.ref
		]);
		await createBlockEditCore(scope).descendToBody(0);
		expect(commits).toHaveLength(0);
		expect(children).toHaveLength(2);
		// An arrival on a block it did not create, so the door — not this caller — picks the byte.
		expect(body.calls).toEqual([CURSOR_START]);
	});

	it('mints and focuses an empty body paragraph when the chrome has no body child', async () => {
		const body = focusSpy();
		const { scope, commits, children } = stubScope([leaf('Title\n')], true, [undefined, body.ref]);
		await createBlockEditCore(scope).descendToBody(0);
		expect(children).toHaveLength(2);
		expect(children[1].kind).toBe('paragraph');
		expect(children[1].raw).toBe('\n');
		expect(commits[0].op.kind).toBe('appendBlock');
		expect(commits[0].eventTarget).toBe(1);
		expect(body.calls).toEqual([0]);
	});

	// The minted body IS a line ending, so a defaulted `\n` strands a lone LF
	// inside a CRLF container (G4.20).
	it('the minted body paragraph takes the chrome sibling’s line ending', async () => {
		const { scope, children } = stubScope([leaf('Title\r\n')], true, []);
		await createBlockEditCore(scope).descendToBody(0);
		expect(children[1].raw).toBe('\r\n');
	});

	it('consumes the key without minting when the body ref is windowed out', async () => {
		// Empty refs: the body child exists in the array but is windowed out.
		const { scope, commits, children } = stubScope([leaf('Title\n'), leaf('Body\n')], true, []);
		await createBlockEditCore(scope).descendToBody(0);
		expect(commits).toHaveLength(0);
		expect(children).toHaveLength(2);
	});
});
