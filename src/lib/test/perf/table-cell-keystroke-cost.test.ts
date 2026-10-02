// Miss-analysis: the keystroke cost tests covered lists and quotes, whose rebuild copies only the
// edited chain, and no test counted what a table rebuild copied, which was every row.
import { describe, it, expect } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { documentLineEnding } from '$lib/core/lines';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

const ROWS = 5000;
const TARGET = 2500;
const SOURCE =
	'| a | b |\n| --- | --- |\n' + Array.from({ length: ROWS }, (_, i) => `| ${i} | x |\n`).join('');

describe('a keystroke in one cell of a large table', () => {
	it('copies and writes the edited row alone, every other row keeping its object', () => {
		const { deps } = makeEditorActionsDeps(SOURCE);
		const typing = createLeafTyping(deps, createUndoController(deps));
		// The typing burst's snapshot, which makes every row one an undo entry holds.
		deps.sharing.markSnapshotTaken();
		const before = [...deps.doc.children[0].children!];
		const row = before[TARGET];
		const body = { children: row.children!, owner: row, lineEnding: documentLineEnding(deps.doc) };
		const write = legalizeWrite(body, 1, 'xQ', 'authored');

		expect(typing.writeLeafInPlace(docPathFrom([0, TARGET, 1]), write, 0).wrote).toBe(true);

		const after = deps.doc.children[0].children as CstNode[];
		const moved = after.flatMap((node, i) => (node === before[i] ? [] : [i]));
		expect(moved).toEqual([TARGET]);
		expect(after[TARGET].raw).toBe(`| ${TARGET - 1} | xQ |\n`);
	});
});
