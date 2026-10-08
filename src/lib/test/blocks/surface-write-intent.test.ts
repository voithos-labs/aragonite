// Only a typed write asks the kind cue to name a new kind and the on-type completer to finish its
// line; a command (a chord, a menu row, a clipboard edit, a shown source's commit) and the
// editor's own repair ask neither.
// Miss-analysis: every intent row drove a typed write, so a command running both stayed green.
import { describe, expect, it, vi } from 'vitest';
import type { BlockEditActions } from '#lib/action-contracts.js';
import type { NodeView } from '#lib/core/node-views.js';
import { createSurfaceWrite, type WriteIntent } from '#lib/components/blocks/surface-write.js';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { stubBlockEdit } from '#lib/testing/headless-actions.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { createInsertionRecords } from '#lib/caret/next-insertion.js';

function writerFor() {
	const node: NodeView = { kind: 'paragraph', leadingTrivia: '', raw: 'ab\n' };
	const afterTypedWrite = vi.fn(async () => {});
	const completeLineOnType = vi.fn(async () => false);
	const blockEdit: BlockEditActions = {
		...stubBlockEdit(),
		updateBlockContent: (_index, _text, _mode, _before, after = 0) =>
			withStoredCaret(Promise.resolve(true), after),
		completeLineOnType
	};
	const writeText = createSurfaceWrite({
		getNode: () => node,
		getIndex: () => 0,
		getPath: () => [0],
		blockEdit,
		kindCue: { afterTypedWrite, labelAt: () => undefined, dismiss: () => {} },
		getPreEditOffset: () => 0,
		requestCaret: () => {},
		holdInsertion: () => createInsertionRecords([]).hold({}, null)
	});
	return { writeText, afterTypedWrite, completeLineOnType };
}

describe.each<[WriteIntent, boolean]>([
	['typed', true],
	['command', false],
	['repair', false]
])('a %s write', (intent, asks) => {
	it(`${asks ? 'asks' : 'does not ask'} the kind cue to name the block's kind`, async () => {
		const { writeText, afterTypedWrite } = writerFor();
		await writeText({ text: 'abc', caretAfter: 3, intent, mode: 'authored', source: intent });
		await settleEditor();
		expect(afterTypedWrite).toHaveBeenCalledTimes(asks ? 1 : 0);
	});

	it(`${asks ? 'asks' : 'does not ask'} the on-type completer to finish the line`, async () => {
		const { writeText, completeLineOnType } = writerFor();
		await writeText({ text: 'abc', caretAfter: 3, intent, mode: 'authored', source: intent });
		await settleEditor();
		expect(completeLineOnType).toHaveBeenCalledTimes(asks ? 1 : 0);
	});
});
