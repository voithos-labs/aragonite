// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { findListAbsorb } from '../../../tree-operations/paste/list-absorb';
import { parse } from '../../../core/parser';
import { __resetSchemaRegistriesForTests } from '../../../schema/registry-reset';
import {
	makeStubBlockEdit,
	makeStubController,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import type { AnyBlockKind, CstNode, Document } from '../../../core/nodes';
import { testChromeContainer } from '$lib/test/harness/test-kinds';

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
	});

	// A `\r\n\r\n` break is one run: flattening per-`\n` double-spaces it.
	it.each([
		['LF', 'one\n\ntwo\n'],
		['CRLF (Windows clipboard)', 'one\r\n\r\ntwo\r\n']
	])('flattens a multi-block %s clipboard inline, keeping the chrome one node', async (_, text) => {
		const { container, chrome } = testChromeContainer('spec-chrome-container', 'spec-chrome-title');
		const doc = makeTitledContainerDoc(container, chrome);
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: text, targetPath: [0, 0], offset: 5 },
			pasteContext({ doc, blockEdit, controller: makeStubController() })
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Titleone two\n', 12);
		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
	});

	it('flattens a list clipboard at a chrome path even when an enclosing list would absorb', async () => {
		const { container, chrome } = testChromeContainer('spec-chrome-container', 'spec-chrome-title');
		// The title child sits where findListAbsorb treats the container as a list item, so the
		// container family fires here unless the title check precedes it.
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

		// The container family matches this target, so the title check must win over it.
		expect(findListAbsorb(doc, [0, 0, 0], parse('- a\n- b\n'), 5)).not.toBeNull();

		await pasteDispatch(
			{ pastedText: '- a\n- b\n', targetPath: [0, 0, 0], offset: 5 },
			pasteContext({ doc, blockEdit, controller })
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Title- a - b\n', 12);
		expect(controller.commitMultiScope).not.toHaveBeenCalled();
	});

	it('leaves an ordinary paragraph target on the container absorb path', async () => {
		testChromeContainer('spec-chrome-container', 'spec-chrome-title');
		const doc = parse('- a\n- b\n');
		const list = doc.children[0] as CstNode;
		registerStubBlockListState(list);
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		await pasteDispatch(
			{ pastedText: '- x\n- y\n', targetPath: [0, 1, 0], offset: 1 },
			pasteContext({ doc, blockEdit, controller })
		);

		expect(controller.commitMultiScope).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});
