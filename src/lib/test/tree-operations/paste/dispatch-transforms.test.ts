// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pasteDispatch, __getDefaultTextSurface } from '../../../tree-operations/paste/dispatch';
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
import { makeStubBlockEdit, makeStubController } from '../../harness/editor-actions';
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
	beforeEach(() => {
		__resetPasteSurfacesForTests();
	});

	it('warns in dev mode when target kind has no registered surface', async () => {
		const doc = makeDocWithOneBlock('indentedCode', 'plain\n');
		await pasteDispatch(
			{ pastedText: 'hello', targetPath: [0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() }
		);

		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain('no paste surface registered');
		expect(fires[0].details).toBe('indentedCode');
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
		const doc = makeDocWithOneBlock('paragraph', 'hello\n');
		await pasteDispatch(
			{ pastedText: 'X', targetPath: [0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() }
		);

		expect(takeDevWarns()).toEqual([]);
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
		(controller.commitMultiScope as ReturnType<typeof vi.fn>).mockImplementation(({ mutate }) => {
			mutate([{ children: [...doc.children], node: doc, sharing: createSharingState() }]);
		});

		// The transform turns a would-be inline paste into a heading, so dispatch must
		// re-route structural.
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
