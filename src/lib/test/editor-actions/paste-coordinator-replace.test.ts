// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';

function makePara(raw: string, leadingTrivia = ''): CstNode {
	return { kind: 'paragraph', leadingTrivia, raw };
}

function makeHeading(raw: string): CstNode {
	return { kind: 'heading', leadingTrivia: '', raw, metadata: { level: 1 } };
}

describe('the paste coordinator replace: id preservation', () => {
	it('same-kind first replacement inherits the original block id', async () => {
		const harness = makeEditorActionsDeps([makePara('original\n')]);
		const controller = createPasteCoordinator(harness.deps, createUndoController(harness.deps));
		const originalId = harness.getBlockIds()[0];

		await controller.replaceBlock(
			[0],
			[makePara('replaced\n'), makeHeading('# new\n')],
			{ replacementIndex: 0, offset: 0 },
			{ source: 'paste-dispatch', snapshotOffset: 0 }
		);

		const ids = harness.getBlockIds();
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(originalId);
		expect(ids[1]).not.toBe(originalId);
	});

	it('different-kind first replacement gets a fresh id', async () => {
		const harness = makeEditorActionsDeps([makePara('original\n')]);
		const controller = createPasteCoordinator(harness.deps, createUndoController(harness.deps));
		const originalId = harness.getBlockIds()[0];

		await controller.replaceBlock(
			[0],
			[makeHeading('# new\n'), makePara('after\n')],
			{ replacementIndex: 0, offset: 0 },
			{ source: 'paste-dispatch', snapshotOffset: 0 }
		);

		const ids = harness.getBlockIds();
		expect(ids).toHaveLength(2);
		expect(ids[0]).not.toBe(originalId);
		expect(ids[1]).not.toBe(originalId);
		expect(ids[0]).not.toBe(ids[1]);
	});

	it('empty replacement removes the block', async () => {
		// Separated: three paragraphs with no blank lines between them are one paragraph on reload.
		const harness = makeEditorActionsDeps([
			makePara('a\n'),
			makePara('b\n', '\n'),
			makePara('c\n', '\n')
		]);
		const controller = createPasteCoordinator(harness.deps, createUndoController(harness.deps));
		const idsBefore = [...harness.getBlockIds()];

		await controller.replaceBlock(
			[1],
			[],
			{ replacementIndex: 0, offset: 0 },
			{ source: 'paste-dispatch', snapshotOffset: 0 }
		);

		expect(harness.doc.children).toHaveLength(2);
		const ids = harness.getBlockIds();
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(idsBefore[0]);
		expect(ids[1]).toBe(idsBefore[2]);
	});

	it('uses the live old kind read before mutation runs', async () => {
		// A heading already at the path must not make a paragraph replacement read as same-kind.
		const harness = makeEditorActionsDeps([parse('# heading\n').children[0]]);
		const controller = createPasteCoordinator(harness.deps, createUndoController(harness.deps));
		const originalId = harness.getBlockIds()[0];

		await controller.replaceBlock(
			[0],
			[makePara('plain\n')],
			{ replacementIndex: 0, offset: 0 },
			{ source: 'paste-dispatch', snapshotOffset: 0 }
		);

		expect(harness.getBlockIds()[0]).not.toBe(originalId);
	});
});
