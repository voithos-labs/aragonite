// @vitest-environment jsdom
// Miss-analysis: every paste test asserted the bytes and the landing caret, never the caret the
// undo entry records, and the one e2e that did pinned a widget route that bypassed the dispatch.
import { describe, it, expect, beforeAll } from 'vitest';
import type { BlockEditActions } from '$lib/action-contracts';
import type { EditorActionsDeps, UndoController } from '$lib/editor-actions/deps';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { pasteDispatch, type PasteDispatchInput } from '$lib/tree-operations/paste/dispatch';
import { codePasteSurface } from '$lib/components/blocks/code/code-paste-surface';
import { tableCellPasteSurface } from '$lib/components/blocks/table/table-cell-paste';
import {
	makeContainerHarness,
	makeTopHarness,
	mountBodyRow,
	pasteContext,
	registerStubBlockListState
} from '$lib/test/harness/editor-actions';
import { ensurePasteSurface } from '$lib/test/support/paste-surface';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';

interface Bench {
	deps: EditorActionsDeps;
	controller: UndoController;
	/** The action bundle the target's editable element writes through. */
	blockEdit: BlockEditActions;
}

const top = (source: string): Bench => {
	const h = makeTopHarness(source);
	return { deps: h.deps, controller: h.controller, blockEdit: h.actions };
};
const inContainer =
	(path: number[]) =>
	(source: string): Bench => {
		const h = makeContainerHarness(source, path);
		return { deps: h.deps, controller: h.controller, blockEdit: h.bundle.blockEdit };
	};

interface PasteRoute {
	name: string;
	source: string;
	bench: (source: string) => Bench;
	input: Omit<PasteDispatchInput, 'targetPath'>;
	targetPath: number[];
	crossBlock?: boolean;
	/** The container routes resolve the top-level container's state through the registry. */
	registersContainer?: boolean;
	/** Where the caret was when the paste began. */
	caretBefore: number;
}

// Each paste route the editor reaches, by what its caller hands the dispatch.
const ROUTES: PasteRoute[] = [
	{
		name: 'prose, at a collapsed caret',
		source: 'hello world\n',
		bench: top,
		targetPath: [0],
		input: { pastedText: 'XY', offset: 5 },
		caretBefore: 5
	},
	{
		name: 'prose, over a selection',
		source: 'hello world\n',
		bench: top,
		targetPath: [0],
		input: { pastedText: 'there', offset: 6, preDelete: { start: 6, end: 11 } },
		caretBefore: 6
	},
	{
		name: 'prose, over a widget selected from its far side',
		source: 'before<br>after\n',
		bench: top,
		targetPath: [0],
		input: { pastedText: 'X', offset: 6, preDelete: { start: 6, end: 10 }, caretBefore: 10 },
		caretBefore: 10
	},
	{
		name: 'a list item’s paragraph',
		source: '- hello world\n',
		bench: inContainer([0, 0]),
		targetPath: [0, 0, 0],
		input: { pastedText: 'XY', offset: 5 },
		caretBefore: 5
	},
	{
		name: 'a quote’s paragraph',
		source: '> hello world\n',
		bench: inContainer([0]),
		targetPath: [0, 0],
		input: { pastedText: 'there', offset: 6, preDelete: { start: 6, end: 11 } },
		caretBefore: 6
	},
	{
		name: 'a table cell',
		source: '| A | B |\n| --- | --- |\n| ab | c |\n',
		bench: mountBodyRow,
		targetPath: [0, 1, 0],
		input: { pastedText: 'XY', offset: 1 },
		caretBefore: 1
	},
	{
		name: 'a code block',
		source: '```\nhello world\n```\n',
		bench: top,
		targetPath: [0],
		input: { pastedText: 'a\n\nb', offset: 9 },
		caretBefore: 9
	},
	{
		name: 'the caret a cross-block delete left',
		source: 'hello world\n',
		bench: top,
		targetPath: [0],
		input: { pastedText: 'XY', offset: 5 },
		crossBlock: true,
		caretBefore: 5
	},
	{
		name: 'prose, pasting blocks',
		source: 'hello world\n',
		bench: top,
		targetPath: [0],
		input: { pastedText: 'a\n\nb\n', offset: 5 },
		caretBefore: 5
	},
	{
		name: 'a list item, pasting a list it absorbs',
		source: '- alpha\n- beta\n',
		bench: top,
		targetPath: [0, 0, 0],
		registersContainer: true,
		input: { pastedText: '* one\n* two\n', offset: 3 },
		caretBefore: 3
	},
	{
		name: 'a list item, pasting a list it breaks out of',
		source: '- one\n- two\n',
		bench: top,
		targetPath: [0, 1, 0],
		input: { pastedText: '1. x\n', offset: 2 },
		caretBefore: 2
	},
	{
		name: 'a list item, pasting items its list takes in',
		source: '1. one\n2. two\n',
		bench: top,
		targetPath: [0, 0, 0],
		registersContainer: true,
		input: { pastedText: '1. INSERTED\n', offset: 2 },
		crossBlock: true,
		caretBefore: 2
	},
	{
		name: 'a list item, pasting two items its list takes in',
		source: '1. one\n2. two\n',
		bench: top,
		targetPath: [0, 0, 0],
		registersContainer: true,
		input: { pastedText: '1. A\n2. B\n', offset: 2 },
		crossBlock: true,
		caretBefore: 2
	},
	{
		name: 'a blank quote body block, pasting a quote',
		source: '> a\n>\n>\n> b\n',
		bench: top,
		targetPath: [0, 1],
		registersContainer: true,
		input: { pastedText: '> X\n>\n> Y\n', offset: 0 },
		caretBefore: 0
	}
];

beforeAll(() => {
	ensurePasteSurface(codePasteSurface);
	ensurePasteSurface(tableCellPasteSurface);
});

describe('a paste’s undo entry records the caret where the paste began', () => {
	for (const route of ROUTES) {
		it(route.name, async () => {
			const { deps, controller, blockEdit } = route.bench(route.source);
			if (route.registersContainer) registerStubBlockListState(deps.doc.children[0]);
			const sourceBefore = deps.doc.children.map((c) => c.raw).join('');

			await pasteDispatch(
				{ ...route.input, targetPath: route.targetPath },
				pasteContext({
					doc: deps.doc,
					blockEdit,
					controller: createPasteCoordinator(deps, controller),
					crossBlock: route.crossBlock
				})
			);

			// The paste wrote, so the entry below is its own.
			expect(deps.doc.children.map((c) => c.raw).join('')).not.toBe(sourceBefore);
			const entry = deps.undoManager.peekUndo();
			expect(entry).not.toBeNull();
			// One paste is one undo step, however many writes it made.
			expect(deps.undoManager.getStacks().undo).toHaveLength(1);
			const point = { path: route.targetPath, offset: route.caretBefore };
			expect(rangeSelectionOf(entry!)).toEqual({ anchor: point, focus: point });
		});
	}
});
