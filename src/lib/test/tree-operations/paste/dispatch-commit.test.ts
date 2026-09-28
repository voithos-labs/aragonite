// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { parse } from '../../../core/parser';
import { createGrammarView } from '../../../schema/block-openers';
import { createSharingState } from '../../../tree-operations/sharing';
import { createUndoController } from '../../../editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '../../../editor-actions/paste-coordinator';
import {
	makeEditorActionsDeps,
	makeStubBlockEdit,
	makeStubController,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import type { CstNode } from '../../../core/nodes';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

// ── Container-matching merge runs its raw mutation inside commitMultiScope ────

function makeMergeFixture() {
	const doc = parse('1. one\n2. two\n');
	const list = doc.children[0] as CstNode;
	const targetLeaf = list.children![0].children![0] as CstNode;
	registerStubBlockListState(list);
	return { doc, targetLeaf, rawBefore: targetLeaf.raw };
}

describe('paste-dispatch: applyContainerMatchingMerge mutate-inside-commit invariant', () => {
	it('singleton-merge: targetLeaf.raw is unchanged until commitMultiScope.mutate runs', async () => {
		const { doc, targetLeaf, rawBefore } = makeMergeFixture();

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
			pasteContext({
				doc,
				blockEdit: makeStubBlockEdit(),
				controller,
				crossBlock: true
			})
		);

		expect(captured.mutate).not.toBeNull();
		// The pre-mutation raw at invocation is what makes the snapshot capture pre-mutation state.
		expect(rawAtCommitInvocation).toBe(rawBefore);
		expect(targetLeaf.raw).not.toBe(rawBefore);
		expect(targetLeaf.raw).toContain('INSERTED');
	});

	it('multi-item merge: target and last leaves unchanged until commitMultiScope.mutate runs', async () => {
		const { doc, targetLeaf, rawBefore } = makeMergeFixture();

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
			pasteContext({
				doc,
				blockEdit: makeStubBlockEdit(),
				controller,
				crossBlock: true
			})
		);

		expect(rawAtCommit).toBe(rawBefore);
		expect(targetLeaf.raw).toContain('ALPHA');
	});
});

// ── Cross-block inline join reparse ──────────────────────────────────────────

describe('pasteDispatch: cross-block inline join reparse', () => {
	// A join paste completing marker syntax at offset 0 must put a node of the reparsed kind in
	// the position, mirroring the non-join sibling's reparse path, or parse(serialize(live)) diverges.
	it('completing an ordered-list marker re-creates the block as a list', async () => {
		const { deps } = makeEditorActionsDeps(parse('. item\n').children);
		expect(deps.doc.children[0].kind).toBe('paragraph');

		await pasteDispatch(
			{ pastedText: '1', targetPath: [0], offset: 0 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(deps, createUndoController(deps)),
				crossBlock: true
			})
		);

		expect(deps.doc.children[0].raw).toBe('1. item\n');
		expect(deps.doc.children[0].kind).toBe('list');
	});

	// The join reparse is a content commit, so it parses with the editor instance's grammar.
	it('threads the instance grammar so a disabled list opener leaves a paragraph', async () => {
		const reading = fixtureReading({ grammar: createGrammarView((kind) => kind !== 'list') });
		const { deps } = makeEditorActionsDeps(parse('. item\n').children, { reading });

		await pasteDispatch(
			{ pastedText: '1', targetPath: [0], offset: 0 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(deps, createUndoController(deps)),
				crossBlock: true,
				reading
			})
		);

		expect(deps.doc.children[0].raw).toBe('1. item\n');
		expect(deps.doc.children[0].kind).toBe('paragraph');
	});
});

// ── pasteDispatch end-to-end routing ────────────────────────────────────────

describe('pasteDispatch: strategy routing end-to-end', () => {
	it('inline strategy: single-paragraph clipboard routes through blockEdit.updateBlockContent', async () => {
		const doc = parse('hello world\n');
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: 'XYZ', targetPath: [0], offset: 6 },
			pasteContext({ doc, blockEdit, controller: makeStubController() })
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledOnce();
		const call = (blockEdit.updateBlockContent as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call[0]).toBe(0);
		expect(call[1]).toBe('hello XYZworld\n');
		expect(call[2]).toBe('literal');
		expect(call[3]).toBe(9);
		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
	});

	// Routing at the doc scope bypasses blockEdit, so a caller passing a nested-bundle
	// blockEdit cannot misroute the splice into a child container.
	it('structural strategy: multi-block clipboard replaces the target through the coordinator', async () => {
		const doc = parse('target\n');
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		await pasteDispatch(
			{ pastedText: '# heading\n\nbody\n', targetPath: [0], offset: 6 },
			pasteContext({ doc, blockEdit, controller })
		);

		expect(controller.replaceBlock).toHaveBeenCalledOnce();
		const [path, , , opts] = (controller.replaceBlock as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(path).toEqual([0]);
		expect(opts.source).toBe('paste-dispatch');

		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});
