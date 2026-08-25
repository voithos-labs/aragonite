// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { pasteDispatch, defaultInlineHook } from '../../../tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '../../../tree-operations/paste-surfaces';
import { findListAbsorb } from '../../../tree-operations/paste/list-absorb';
import { parse } from '../../../core/parser';
import { declarePluginKind } from '../../../schema/plugin-kind';
import { registerBlockKind } from '../../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import {
	makeStubBlockEdit,
	makeStubController,
	registerStubBlockListState
} from '../../harness/editor-actions';
import type { AnyBlockKind, CstNode, Document } from '../../../core/nodes';

// The shape registerChromeLeaf produces: reserved chrome at child 0 plus the leaf's
// inline-only paste surface.
function registerChromeContainer(): { container: AnyBlockKind; chrome: AnyBlockKind } {
	const chrome = declarePluginKind('spec-chrome-title');
	const container = declarePluginKind('spec-chrome-container');
	registerBlockKind(chrome, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	registerBlockKind(container, {
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: { contract: 'opaque', rebuildRaw: () => {}, reservedChrome: { kind: chrome } }
	});
	registerPasteSurface({ kind: chrome, onInlinePaste: defaultInlineHook });
	return { container, chrome };
}

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

describe('paste into a reserved-chrome leaf', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
	});

	// A `\r\n\r\n` break is one run: flattening per-`\n` double-spaces it.
	it.each([
		['LF', 'one\n\ntwo\n'],
		['CRLF (Windows clipboard)', 'one\r\n\r\ntwo\r\n']
	])('flattens a multi-block %s clipboard inline, keeping the chrome one node', async (_, text) => {
		const { container, chrome } = registerChromeContainer();
		const doc = makeTitledContainerDoc(container, chrome);
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: text, targetPath: [0, 0], offset: 5 },
			{ doc, blockEdit, controller: makeStubController() }
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Titleone two\n', 12);
		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
	});

	it('flattens a list clipboard at a chrome path even when an enclosing list would absorb', async () => {
		const { container, chrome } = registerChromeContainer();
		// The chrome leaf sits where findListAbsorb treats the container as a list item, so the
		// container family fires here unless the chrome gate precedes it.
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
		registerStubBlockListState(list);
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		// The container family matches this target, so the gate must win over it.
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
		registerStubBlockListState(list);
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		await pasteDispatch(
			{ pastedText: '- x\n- y\n', targetPath: [0, 1, 0], offset: 1 },
			{ doc, blockEdit, controller }
		);

		expect(controller.commitMultiScope).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});
