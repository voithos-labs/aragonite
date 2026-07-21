// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pasteDispatch, __getDefaultTextSurface } from '../../../tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '../../../tree-operations/paste-surfaces';
import { parse } from '../../../core/parser';
import { createGrammarView } from '../../../schema/block-openers';
import { createSharingState } from '../../../tree-operations/sharing';
import { registerBlockListState } from '../../../reactivity/state-registry';
import { makeStubBlockEdit, makeStubController } from '../../harness/editor-actions';
import type { CstNode } from '../../../core/nodes';
import type { BlockComponent } from '../../../block-component';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';

// ── Container-matching merge runs its raw mutation inside commitMultiScope ────

function makeStubBlockListState(node: CstNode) {
	const state: any = {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined as BlockComponent | undefined)
	};
	registerBlockListState(node, state);
	return state;
}

describe('paste-dispatch — applyContainerMatchingMerge mutate-inside-commit invariant', () => {
	it('singleton-merge: targetLeaf.raw is unchanged until commitMultiScope.mutate runs', async () => {
		const doc = parse('1. one\n2. two\n');
		const list = doc.children[0] as CstNode;
		const firstItem = list.children![0] as CstNode;
		const targetLeaf = firstItem.children![0] as CstNode;
		const rawBefore = targetLeaf.raw;
		makeStubBlockListState(list);

		// Singleton clipboard: one matching ordered-list item with one paragraph.
		const pastedText = '1. INSERTED\n';

		let rawAtCommitInvocation: string | null = null;
		const captured: { mutate: ((scopes: any[]) => any[]) | null } = { mutate: null };

		const controller = {
			...makeStubController(),
			commitMultiScope: vi.fn(async ({ scopes, mutate }) => {
				rawAtCommitInvocation = targetLeaf.raw;
				captured.mutate = mutate;
				const sharing = createSharingState();
				mutate(scopes.map((s: { node: CstNode }) => ({ children: [], node: s.node, sharing })));
			})
		} as unknown as PasteCommitCoordinator;

		await pasteDispatch(
			{ pastedText, targetPath: [0, 0, 0], offset: 'one'.length },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller,
				undoEntry: 'join'
			}
		);

		expect(captured.mutate).not.toBeNull();
		// commitMultiScope was invoked with the pre-mutation raw — proves the
		// snapshot would capture pre-mutation state.
		expect(rawAtCommitInvocation).toBe(rawBefore);
		// After mutate ran inside the stub's call, the raw is now updated.
		expect(targetLeaf.raw).not.toBe(rawBefore);
		expect(targetLeaf.raw).toContain('INSERTED');
	});

	it('multi-item merge: target and last leaves unchanged until commitMultiScope.mutate runs', async () => {
		const doc = parse('1. one\n2. two\n');
		const list = doc.children[0] as CstNode;
		const firstItem = list.children![0] as CstNode;
		const targetLeaf = firstItem.children![0] as CstNode;
		const rawBefore = targetLeaf.raw;
		makeStubBlockListState(list);

		// Two-item matching clipboard exercises the multi-item path.
		const pastedText = '1. ALPHA\n2. BETA\n';

		let rawAtCommit: string | null = null;
		const controller = {
			...makeStubController(),
			commitMultiScope: vi.fn(async ({ scopes, mutate }) => {
				rawAtCommit = targetLeaf.raw;
				const sharing = createSharingState();
				const scopeViews = scopes.map((s: { node: CstNode }) => ({
					children: [...(s.node.children ?? [])],
					node: s.node,
					sharing
				}));
				mutate(scopeViews);
			})
		} as unknown as PasteCommitCoordinator;

		await pasteDispatch(
			{ pastedText, targetPath: [0, 0, 0], offset: 'one'.length },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller,
				undoEntry: 'join'
			}
		);

		expect(rawAtCommit).toBe(rawBefore);
		expect(targetLeaf.raw).toContain('ALPHA');
	});
});

// ── Cross-block inline join reparse ──────────────────────────────────────────

describe('pasteDispatch — cross-block inline join reparse', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
		registerPasteSurface(__getDefaultTextSurface('paragraph'));
	});

	// A join paste that completes marker syntax at offset 0 must re-mint the slot
	// at the reparsed kind, not leave a paragraph-typed node holding list bytes
	// (parse(serialize(live)) would then diverge). The non-join sibling routes
	// through updateBlockContent → the funnel; the join branch must mirror it.
	it('completing an ordered-list marker re-mints the block as a list', async () => {
		const doc = parse('. item\n');
		expect(doc.children[0].kind).toBe('paragraph');

		await pasteDispatch(
			{ pastedText: '1', targetPath: [0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController(), undoEntry: 'join' }
		);

		expect(doc.children[0].raw).toBe('1. item\n');
		expect(doc.children[0].kind).toBe('list');
	});

	// The join reparse is content-commit-class, so it threads the instance grammar:
	// an instance whose grammar drops the list opener keeps the completion a paragraph.
	it('threads the instance grammar so a disabled list opener leaves a paragraph', async () => {
		const doc = parse('. item\n');

		await pasteDispatch(
			{ pastedText: '1', targetPath: [0], offset: 0 },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeStubController(),
				undoEntry: 'join',
				grammar: createGrammarView((kind) => kind !== 'list')
			}
		);

		expect(doc.children[0].raw).toBe('1. item\n');
		expect(doc.children[0].kind).toBe('paragraph');
	});
});

// ── pasteDispatch end-to-end routing ────────────────────────────────────────

describe('pasteDispatch — strategy routing end-to-end', () => {
	// Register-once: clear first, then register the paragraph default so routing
	// sees the same surface it would in the app, independent of prior describes.
	beforeEach(() => {
		__resetPasteSurfacesForTests();
		registerPasteSurface(__getDefaultTextSurface('paragraph'));
	});

	it('inline strategy: single-paragraph clipboard routes through blockEdit.updateBlockContent', async () => {
		const doc = parse('hello world\n');
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: 'XYZ', targetPath: [0], offset: 6 },
			{ doc, blockEdit, controller: makeStubController() }
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledOnce();
		const call = (blockEdit.updateBlockContent as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call[0]).toBe(0);
		expect(call[1]).toBe('hello XYZworld\n');
		expect(call[2]).toBe(9);
		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
	});

	// Routes through controller.commitMultiScope at the doc scope — bypasses
	// blockEdit so callers passing a nested-bundle blockEdit (e.g., a row-level
	// bundle for a cell's path) can't misroute the splice into a child container.
	it('structural strategy: multi-block clipboard routes through controller.commitMultiScope at doc scope', async () => {
		const doc = parse('target\n');
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();
		const docScope = {
			node: doc,
			state: { innerBlockIds: ['iid-0'], innerBlockRefs: [undefined] }
		};
		(controller.getDocScope as ReturnType<typeof vi.fn>).mockReturnValue(docScope);
		(controller.commitMultiScope as ReturnType<typeof vi.fn>).mockImplementation(({ mutate }) => {
			mutate([{ children: [...doc.children], node: doc, sharing: createSharingState() }]);
		});

		await pasteDispatch(
			{ pastedText: '# heading\n\nbody\n', targetPath: [0], offset: 6 },
			{ doc, blockEdit, controller }
		);

		expect(controller.commitMultiScope).toHaveBeenCalledOnce();
		const args = (controller.commitMultiScope as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(args.scopes).toHaveLength(1);
		expect(args.scopes[0]).toBe(docScope);
		expect(args.op.kind).toBe('replaceBlock');
		expect(args.op.eventPath).toEqual([0]);

		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});
