// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { registerPasteTransform } from '../../../tree-operations/paste/paste-transforms';
import { parse } from '../../../core/parser';
import { makeStubBlockEdit, makeStubController, pasteContext } from '../../harness/editor-actions';
import type { BlockKind, CstNode, Document } from '../../../core/nodes';
import { takeDevWarns } from '../../support/warn-gate';

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

describe('paste-dispatch opaque-fallback warning', () => {
	it('warns in dev mode when target kind has no registered surface', async () => {
		const doc = makeDocWithOneBlock('indentedCode', 'plain\n');
		await pasteDispatch(
			{ pastedText: 'hello', targetPath: [0], offset: 0 },
			pasteContext({ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() })
		);

		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain('no paste surface registered');
		expect(fires[0].details).toBe('indentedCode');
	});

	it('does not warn when target kind has a registered surface', async () => {
		// The built-in paragraph surface, registered when the paste hooks load.
		const doc = makeDocWithOneBlock('paragraph', 'hello\n');
		await pasteDispatch(
			{ pastedText: 'X', targetPath: [0], offset: 0 },
			pasteContext({ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() })
		);

		expect(takeDevWarns()).toEqual([]);
	});
});

// ── Paste transforms rewrite the clipboard text before strategy selection ────

describe('pasteDispatch: paste transforms', () => {
	it('a transform that rewrites prose into a heading flips the paste inline → structural', async () => {
		registerPasteTransform({ name: 'headingize', transform: () => '# heading\n' });

		const doc = parse('target\n');
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		await pasteDispatch(
			{ pastedText: 'plain prose', targetPath: [0], offset: 6 },
			pasteContext({ doc, blockEdit, controller })
		);

		expect(controller.replaceBlock).toHaveBeenCalledOnce();
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('a transform that empties the text makes the paste a no-op', async () => {
		registerPasteTransform({ name: 'eraser', transform: () => '' });

		const doc = parse('hello world\n');
		const blockEdit = makeStubBlockEdit();
		const controller = makeStubController();

		const result = await pasteDispatch(
			{ pastedText: 'anything', targetPath: [0], offset: 0 },
			pasteContext({ doc, blockEdit, controller })
		);

		expect(result).toEqual({});
		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
		expect(controller.commitMultiScope).not.toHaveBeenCalled();
	});
});
