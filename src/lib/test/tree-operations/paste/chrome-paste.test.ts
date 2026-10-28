// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { findListAbsorb } from '../../../tree-operations/paste/list-absorb';
import { parse } from '../../../core/parser';
import {
	makeStubBlockEdit,
	makeStubController,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import type { AnyBlockKind, CstNode, Document } from '../../../core/nodes';
import { testChromeContainer } from '#lib/test/harness/test-kinds.js';
import { registerCalloutForTests } from '#lib/test/selection/chrome-plugins.js';

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
		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(
			0,
			'Titleone two\n',
			'literal',
			'join-typing',
			5,
			12
		);
		expect(blockEdit.replaceBlock).not.toHaveBeenCalled();
	});

	it('flattens a list clipboard at a chrome path even when an enclosing list would absorb', async () => {
		const { container, chrome } = testChromeContainer('spec-chrome-container', 'spec-chrome-title');
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

		// The list-absorb route would take this target, so the title check has to run before it.
		expect(findListAbsorb(doc, [0, 0, 0], parse('- a\n- b\n'), 5)).not.toBeNull();

		await pasteDispatch(
			{ pastedText: '- a\n- b\n', targetPath: [0, 0, 0], offset: 5 },
			pasteContext({ doc, blockEdit, controller })
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(
			0,
			'Title- a - b\n',
			'literal',
			'join-typing',
			5,
			12
		);
		expect(controller.commitMultiScope).not.toHaveBeenCalled();
	});

	// Miss-analysis (#801): every chrome paste row pasted into a title-only row, so none had a
	// `:::name` marker on the row for the paste to land in.
	it.each([
		['inside the colon run', 2],
		['inside the name', 5],
		['between the name and the title', 10]
	])('a paste %s of an opener line lands at the title start', async (_name, offset) => {
		registerCalloutForTests();
		const doc = parse(':::callout Title\nBody\n:::\n');
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: 'x', targetPath: [0, 0], offset },
			pasteContext({ doc, blockEdit, controller: makeStubController() })
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(
			0,
			':::callout xTitle\n',
			'literal',
			'join-typing',
			offset,
			12
		);
	});

	it('a paste on the end of an untitled opener line starts a title', async () => {
		registerCalloutForTests();
		const doc = parse(':::callout\nBody\n:::\n');
		const blockEdit = makeStubBlockEdit();

		await pasteDispatch(
			{ pastedText: 'x', targetPath: [0, 0], offset: 10 },
			pasteContext({ doc, blockEdit, controller: makeStubController() })
		);

		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(
			0,
			':::callout x\n',
			'literal',
			'join-typing',
			10,
			12
		);
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
