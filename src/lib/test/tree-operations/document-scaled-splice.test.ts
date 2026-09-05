// @vitest-environment jsdom
// Miss-analysis: every splice test spliced a handful of blocks, so no test ever handed a mutation
// door more items than the engine takes as arguments — the count the doors scale with was untested.

import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { spliceChildrenSettled } from '$lib/tree-operations/node-ops';
import { replaceBlockAtParent } from '$lib/tree-operations/paste/replace-block-at-parent';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { CstNode, Document } from '$lib/core/nodes';

/** Past the engine's argument limit (~125k), so one spread would raise a RangeError. */
const OVER_LIMIT = 200_000;

let pasted: Document;

beforeAll(() => {
	pasted = parse('a\n\n'.repeat(OVER_LIMIT));
});

const clipboard = (): CstNode[] => pasted.children.slice();

const para = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

describe('a document-scaled splice', () => {
	it('lands through the childIds door', () => {
		const container: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '',
			metadata: { quoteDepth: 1 },
			children: [para('a\n')],
			childIds: ['id-a'],
			innerPrefix: '',
			innerSuffix: ''
		};
		spliceChildrenSettled(container, 0, 1, clipboard());
		expect(container.children).toHaveLength(OVER_LIMIT);
		expect(container.childIds).toHaveLength(OVER_LIMIT);
	});

	it('lands through the paste route', async () => {
		const harness = makeEditorActionsDeps([para('original\n')]);
		const controller = createPasteCoordinator(
			createUndoController(harness.deps),
			harness.deps.revealPath
		);

		await replaceBlockAtParent({
			doc: harness.doc,
			blockPath: [0],
			replacement: clipboard(),
			controller,
			undoEntry: 'join',
			focusReplacementIndex: 0,
			focusOffset: 0,
			source: 'paste-dispatch'
		});

		expect(harness.doc.children).toHaveLength(OVER_LIMIT);
		expect(harness.getBlockIds()).toHaveLength(OVER_LIMIT);
	});
});
