// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { replaceBlockAtParent } from '$lib/tree-operations/paste/replace-block-at-parent';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';

function makePara(raw: string, leadingTrivia = ''): CstNode {
	return { kind: 'paragraph', leadingTrivia, raw };
}

function makeHeading(raw: string): CstNode {
	return { kind: 'heading', leadingTrivia: '', raw, metadata: { level: 1 } };
}

describe('replaceBlockAtParent — id preservation', () => {
	it('same-kind first replacement inherits the original block id', async () => {
		const harness = makeEditorActionsDeps([makePara('original\n')]);
		const controller = createPasteCoordinator(
			createUndoController(harness.deps),
			harness.deps.revealPath
		);
		const originalId = harness.getBlockIds()[0];

		await replaceBlockAtParent({
			doc: harness.doc,
			blockPath: [0],
			replacement: [makePara('replaced\n'), makeHeading('# new\n')],
			controller,
			undoEntry: 'join',
			focusReplacementIndex: 0,
			focusOffset: 0,
			source: 'paste-dispatch'
		});

		const ids = harness.getBlockIds();
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(originalId);
		expect(ids[1]).not.toBe(originalId);
	});

	it('different-kind first replacement gets a fresh id', async () => {
		const harness = makeEditorActionsDeps([makePara('original\n')]);
		const controller = createPasteCoordinator(
			createUndoController(harness.deps),
			harness.deps.revealPath
		);
		const originalId = harness.getBlockIds()[0];

		await replaceBlockAtParent({
			doc: harness.doc,
			blockPath: [0],
			replacement: [makeHeading('# new\n'), makePara('after\n')],
			controller,
			undoEntry: 'join',
			focusReplacementIndex: 0,
			focusOffset: 0,
			source: 'paste-dispatch'
		});

		const ids = harness.getBlockIds();
		expect(ids).toHaveLength(2);
		expect(ids[0]).not.toBe(originalId);
		expect(ids[1]).not.toBe(originalId);
		expect(ids[0]).not.toBe(ids[1]);
	});

	it('empty replacement removes the block', async () => {
		// Separated: three trivia-less paragraphs are one paragraph on reload.
		const harness = makeEditorActionsDeps([
			makePara('a\n'),
			makePara('b\n', '\n'),
			makePara('c\n', '\n')
		]);
		const controller = createPasteCoordinator(
			createUndoController(harness.deps),
			harness.deps.revealPath
		);
		const idsBefore = [...harness.getBlockIds()];

		await replaceBlockAtParent({
			doc: harness.doc,
			blockPath: [1],
			replacement: [],
			controller,
			undoEntry: 'join',
			focusReplacementIndex: 0,
			focusOffset: 0,
			source: 'paste-dispatch'
		});

		expect(harness.doc.children).toHaveLength(2);
		const ids = harness.getBlockIds();
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(idsBefore[0]);
		expect(ids[1]).toBe(idsBefore[2]);
	});

	it('uses the live old kind read before mutation runs', async () => {
		// A heading already at the path must not make a paragraph replacement read as same-kind.
		const harness = makeEditorActionsDeps([parse('# heading\n').children[0]]);
		const controller = createPasteCoordinator(
			createUndoController(harness.deps),
			harness.deps.revealPath
		);
		const originalId = harness.getBlockIds()[0];

		await replaceBlockAtParent({
			doc: harness.doc,
			blockPath: [0],
			replacement: [makePara('plain\n')],
			controller,
			undoEntry: 'join',
			focusReplacementIndex: 0,
			focusOffset: 0,
			source: 'paste-dispatch'
		});

		expect(harness.getBlockIds()[0]).not.toBe(originalId);
	});
});
