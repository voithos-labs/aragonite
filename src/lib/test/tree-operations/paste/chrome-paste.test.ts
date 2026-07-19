// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pasteDispatch, defaultInlineHook } from '../../../tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '../../../tree-operations/paste-surfaces';
import { findListAbsorb } from '../../../tree-operations/paste/list-absorb';
import { parse } from '../../../core/parser';
import { createSharingState } from '../../../tree-operations/sharing';
import { declarePluginKind } from '../../../schema/plugin-kind';
import { registerBlockKind } from '../../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import {
	expectStateForNode,
	getStateForNode,
	registerBlockListState
} from '../../../reactivity/state-registry';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import type { AnyBlockKind, CstNode, Document } from '../../../core/nodes';
import type { UndoController } from '../../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';

// A container declaring its child 0 as reserved chrome, plus the chrome leaf and
// the leaf's inline-only paste surface — the shape registerChromeLeaf produces.
function registerChromeContainer(): { container: AnyBlockKind; chrome: AnyBlockKind } {
	const chrome = declarePluginKind('spec-chrome-title');
	const container = declarePluginKind('spec-chrome-container');
	registerBlockKind(chrome, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	registerBlockKind(container, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: { contract: 'opaque', rebuildRaw: () => {}, reservedChrome: { kind: chrome } }
	});
	registerPasteSurface({ kind: chrome, onInlinePaste: defaultInlineHook });
	return { container, chrome };
}

// One titled container: [0,0]=chrome leaf "Title", [0,1]=body paragraph "Body".
function makeTitledContainerDoc(container: AnyBlockKind, chrome: AnyBlockKind): Document {
	return {
		kind: 'document',
		prefix: '',
		suffix: '',
		children: [
			{
				kind: container,
				leadingTrivia: '',
				raw: ':::spec Title\nBody\n:::\n',
				children: [
					{ kind: chrome, leadingTrivia: '', raw: 'Title\n' },
					{ kind: 'paragraph', leadingTrivia: '', raw: 'Body\n' }
				]
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

function registerListState(node: CstNode) {
	registerBlockListState(node, {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined)
	} as never);
}

describe('paste into a reserved-chrome leaf', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
	});

	it('flattens a multi-block clipboard inline, keeping the chrome one node', async () => {
		const { container, chrome } = registerChromeContainer();
		const doc = makeTitledContainerDoc(container, chrome);
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: 'one\n\ntwo\n', targetPath: [0, 0], offset: 5 },
			{ doc, blockEdit, controller: makeStubController() }
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Titleone two\n', 12);
		// Inline splice, not a structural split of the chrome node.
		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
	});

	it('collapses a CRLF paragraph break to a single space (Windows clipboard)', async () => {
		const { container, chrome } = registerChromeContainer();
		const doc = makeTitledContainerDoc(container, chrome);
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: 'one\r\n\r\ntwo\r\n', targetPath: [0, 0], offset: 5 },
			{ doc, blockEdit, controller: makeStubController() }
		);

		// A `\r\n\r\n` break is one run, not two — flattening per-`\n` double-spaces it.
		expect(blockEdit.updateBlockContent).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Titleone two\n', 12);
		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
	});

	it('flattens a list clipboard at a chrome path even when an enclosing list would absorb', async () => {
		const { container, chrome } = registerChromeContainer();
		// list → chrome-container → chrome-leaf: the chrome leaf sits where
		// findListAbsorb treats the container as a list item, so the container
		// family would fire here if the chrome gate did not precede it.
		const list: CstNode = {
			kind: 'list',
			leadingTrivia: '',
			raw: '',
			metadata: { ordered: false },
			children: [
				{
					kind: container,
					leadingTrivia: '',
					raw: ':::spec Title\nBody\n:::\n',
					children: [
						{ kind: chrome, leadingTrivia: '', raw: 'Title\n' },
						{ kind: 'paragraph', leadingTrivia: '', raw: 'Body\n' }
					]
				} as CstNode
			]
		};
		const doc: Document = { kind: 'document', prefix: '', suffix: '', children: [list] };
		registerListState(list);
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		// The container family matches this target — the gate must win regardless.
		expect(findListAbsorb(doc, [0, 0, 0], parse('- a\n- b\n'), 5)).not.toBeNull();

		await pasteDispatch(
			{ pastedText: '- a\n- b\n', targetPath: [0, 0, 0], offset: 5 },
			{ doc, blockEdit, controller }
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Title- a - b\n', 12);
		expect(controller.commitMultiScope).not.toHaveBeenCalled();
	});

	it('leaves an ordinary paragraph target on the container absorb path', async () => {
		registerChromeContainer();
		const doc = parse('- a\n- b\n');
		const list = doc.children[0] as CstNode;
		registerListState(list);
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		await pasteDispatch(
			{ pastedText: '- x\n- y\n', targetPath: [0, 1, 0], offset: 1 },
			{ doc, blockEdit, controller }
		);

		// The gate is scoped to chrome children: a plain list item still absorbs.
		expect(controller.commitMultiScope).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});
