// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	pasteDispatch,
	pickPasteStrategy,
	defaultInlineHook,
	defaultStructuralHook,
	__getDefaultTextSurface
} from '../../../tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '../../../tree-operations/paste-surfaces';
import {
	__resetPasteTransformsForTests,
	registerPasteTransform
} from '../../../tree-operations/paste/paste-transforms';
import { parse } from '../../../core/parser';
import { createSharingState } from '../../../tree-operations/sharing';
import {
	expectStateForNode,
	getStateForNode,
	registerBlockListState
} from '../../../reactivity/state-registry';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import type { BlockKind, CstNode, Document } from '../../../core/nodes';
import type { BlockComponent } from '../../../block-component';
import type { UndoController } from '../../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';

function makePara(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

describe('paste-dispatch — strategy selection', () => {
	it('picks inline for a single-paragraph clipboard', () => {
		const parsed = parse('just some text\n');
		expect(pickPasteStrategy(parsed)).toBe('inline');
	});

	it('picks structural for multiple paragraphs', () => {
		const parsed = parse('para one\n\npara two\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single heading', () => {
		const parsed = parse('# just a heading\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single list', () => {
		const parsed = parse('- just an item\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single code block', () => {
		const parsed = parse('```\ncode\n```\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});
});

describe('paste-dispatch — default inline hook', () => {
	it('splices text at offset into raw', () => {
		const node = makePara('hello world\n');
		const result = defaultInlineHook(node, 5, ' XYZ');
		expect(result.newRaw).toBe('hello XYZ world\n');
		expect(result.caretOffset).toBe(9);
	});

	it('with preDelete: removes range then splices', () => {
		const node = makePara('hello world\n');
		const result = defaultInlineHook(node, 0, 'XYZ', { start: 0, end: 5 });
		expect(result.newRaw).toBe('XYZ world\n');
		expect(result.caretOffset).toBe(3);
	});

	it('preserves CRLF line ending', () => {
		const node = makePara('hello\r\n');
		const result = defaultInlineHook(node, 5, '!');
		expect(result.newRaw).toBe('hello!\r\n');
	});

	it('with empty preDelete range is equivalent to no preDelete', () => {
		const node = makePara('hello\n');
		const a = defaultInlineHook(node, 3, 'X', { start: 3, end: 3 });
		const b = defaultInlineHook(node, 3, 'X');
		expect(a).toEqual(b);
	});
});

describe('paste-dispatch — default structural hook', () => {
	it('delegates to buildPastedReplacement for a single heading', () => {
		const node = makePara('target\n');
		const blocks = parse('# heading\n').children;
		const result = defaultStructuralHook(node, 6, blocks);
		expect(result.replacement.length).toBeGreaterThan(0);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 1);
	});

	it('produces a replacement sequence for multi-block input', () => {
		const node = makePara('target\n');
		const blocks = parse('# heading\n\npara\n').children;
		const result = defaultStructuralHook(node, 6, blocks);
		expect(result.replacement.length).toBeGreaterThanOrEqual(2);
	});
});

// ── Dev-mode opaque-fallback warning ─────────────────────────────────────

function makeDocWithOneBlock(kind: BlockKind, raw: string): Document {
	return {
		kind: 'document',
		prefix: '',
		suffix: '',
		children: [
			{
				kind,
				leadingTrivia: '',
				raw
			} as CstNode
		]
	};
}

function makeStubController(): UndoController & PasteCommitCoordinator {
	return {
		sharing: createSharingState(),
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn(),
		resolveState: getStateForNode,
		expectState: expectStateForNode
	} as unknown as UndoController & PasteCommitCoordinator;
}

describe('paste-dispatch opaque-fallback warning', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
	});

	it('warns in dev mode when target kind has no registered surface', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const doc = makeDocWithOneBlock('indentedCode', 'plain\n');
		await pasteDispatch(
			{ pastedText: 'hello', targetPath: [0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() }
		);

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('No paste surface registered for kind'),
			expect.stringContaining('indentedCode'),
			expect.any(String)
		);

		warn.mockRestore();
	});

	it('does not warn when target kind has a registered surface', async () => {
		registerPasteSurface({
			kind: 'paragraph',
			onInlinePaste: (node, offset, text) => ({
				newRaw: node.raw.slice(0, offset) + text + node.raw.slice(offset),
				caretOffset: offset + text.length
			}),
			onStructuralPaste: () => ({ replacement: [], focusReplacementIndex: 0, focusOffset: 0 })
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const doc = makeDocWithOneBlock('paragraph', 'hello\n');
		await pasteDispatch(
			{ pastedText: 'X', targetPath: [0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() }
		);

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});

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
		(controller.commitMultiScope as ReturnType<typeof vi.fn>).mockImplementation(
			async ({ mutate }) => {
				mutate([{ children: [...doc.children], node: doc, sharing: createSharingState() }]);
			}
		);

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

// ── Paste transforms rewrite the clipboard text before strategy selection ────

describe('pasteDispatch — paste transforms', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
		__resetPasteTransformsForTests();
		registerPasteSurface(__getDefaultTextSurface('paragraph'));
	});

	it('a transform that rewrites prose into a heading flips the paste inline → structural', async () => {
		registerPasteTransform({ name: 'headingize', transform: () => '# heading\n' });

		const doc = parse('target\n');
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();
		const docScope = {
			node: doc,
			state: { innerBlockIds: ['iid-0'], innerBlockRefs: [undefined] }
		};
		(controller.getDocScope as ReturnType<typeof vi.fn>).mockReturnValue(docScope);
		(controller.commitMultiScope as ReturnType<typeof vi.fn>).mockImplementation(
			async ({ mutate }) => {
				mutate([{ children: [...doc.children], node: doc, sharing: createSharingState() }]);
			}
		);

		// A single-paragraph clipboard would paste inline; the transform makes it a
		// heading, so dispatch must route structural instead.
		await pasteDispatch(
			{ pastedText: 'plain prose', targetPath: [0], offset: 6 },
			{ doc, blockEdit, controller }
		);

		expect(controller.commitMultiScope).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('a transform that empties the text makes the paste a no-op', async () => {
		registerPasteTransform({ name: 'eraser', transform: () => '' });

		const doc = parse('hello world\n');
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		const result = await pasteDispatch(
			{ pastedText: 'anything', targetPath: [0], offset: 0 },
			{ doc, blockEdit, controller }
		);

		expect(result).toEqual({});
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
		expect(controller.commitMultiScope).not.toHaveBeenCalled();
	});
});
