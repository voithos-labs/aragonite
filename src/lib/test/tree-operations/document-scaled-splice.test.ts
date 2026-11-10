// @vitest-environment jsdom
// Miss-analysis: every splice test spliced a handful of blocks, never past V8's argument limit.

import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { spliceFixedUp } from '#lib/tree-operations/fix-up/apply.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';

/** Past V8's argument limit (~125k), so one spread would raise a RangeError. */
const OVER_LIMIT = 200_000;

let pasted: Document;

beforeAll(() => {
	pasted = parse('a\n\n'.repeat(OVER_LIMIT));
});

const clipboard = (): CstNode[] => pasted.children.slice();

const para = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

// A 200k-block splice takes seconds on a CI runner; the rows ask whether it lands, not how fast.
describe('a document-scaled splice', { timeout: 30_000 }, () => {
	it('lands through the childIds entry point', () => {
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
		const sharing = createSharingState();
		spliceFixedUp(container, 0, 1, clipboard(), defaultGrammarView, sharing, '\n');
		expect(container.children).toHaveLength(OVER_LIMIT);
		expect(container.childIds).toHaveLength(OVER_LIMIT);
	});

	it('lands through the paste route', async () => {
		const harness = makeEditorActionsDeps([para('original\n')]);
		const controller = createPasteCoordinator(harness.deps, createUndoController(harness.deps));

		await controller.replaceBlock(
			[0],
			clipboard(),
			{ replacementIndex: 0, offset: 0 },
			{ source: 'paste-dispatch', snapshotOffset: 0 }
		);

		expect(harness.doc.children).toHaveLength(OVER_LIMIT);
		expect(harness.getBlockIds()).toHaveLength(OVER_LIMIT);
	});
});
