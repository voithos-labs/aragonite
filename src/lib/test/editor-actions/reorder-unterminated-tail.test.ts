// GH #587: in a document with no final line break, a move that gives the last block a follower
// must end its line, and the block that becomes last gives up its ending instead.
// Miss-analysis: every reorder fixture ended in a line break, the property generator included,
// so no move ever took or left the document's unterminated last line.

import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createReorderAction, reorderRunCommand } from '$lib/editor-actions/reorder-action';
import type { ReorderAction } from '$lib/editor-actions/reorder-action';
import type { CommandId } from '$lib/schema/commands';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { makeReorderContainer } from './reorder-harness';

type Move = (reorder: ReorderAction) => Promise<void>;

// The Alt+Arrow chords and the whole-block menu command both nudge; a drop moves by index.
const up =
	(path: number[]): Move =>
	(r) =>
		r.nudgeReorderUnit(path, -1);
const down =
	(path: number[]): Move =>
	(r) =>
		r.nudgeReorderUnit(path, 1);
const drop =
	(path: number[], to: number): Move =>
	(r) =>
		r.moveReorderUnit(path, to);
const command =
	(id: CommandId, path: number[]): Move =>
	async (r) => {
		let pending: Promise<void> = Promise.resolve();
		const claimed = reorderRunCommand(
			id,
			{ nudgeReorderUnit: (p, dir) => (pending = r.nudgeReorderUnit(p, dir)) },
			() => path
		);
		expect(claimed).toBe(true);
		await pending;
	};

function makeTop(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	return {
		doc: harness.doc,
		reorder: createReorderAction(harness.deps, controller),
		undo: createHistoryActions(harness.deps, controller).requestUndo
	};
}

const TOP_LEVEL: { label: string; before: string; after: string; move: Move }[] = [
	{ label: 'Alt+ArrowUp on the last block', before: 'a\n# b', after: '# b\na', move: up([1]) },
	{
		label: 'Alt+ArrowUp on the last block, CRLF',
		before: 'a\r\n# b',
		after: '# b\r\na',
		move: up([1])
	},
	{
		label: 'Alt+ArrowDown on the block above the last',
		before: '# a\nb',
		after: 'b\n# a',
		move: down([0])
	},
	{
		label: 'the block.moveUp command on the last block',
		before: 'a\n# b',
		after: '# b\na',
		move: command('block.moveUp', [1])
	},
	{
		label: 'the block.moveDown command on the block above the last',
		before: '# a\nb',
		after: 'b\n# a',
		move: command('block.moveDown', [0])
	},
	{
		label: 'a drop of the first block at the tail',
		before: '# a\n# b\nc',
		after: '# b\nc\n# a',
		move: drop([0], 2)
	},
	{
		label: 'a drop of the last block at the head',
		before: '# a\n# b\nc',
		after: 'c\n# a\n# b',
		move: drop([2], 0)
	},
	{
		label: 'Alt+ArrowUp across a blank line',
		before: '# a\n\n# b',
		after: '# b\n\n# a',
		move: up([1])
	},
	{
		label: 'Alt+ArrowUp on the last block of a document that ends in a break',
		before: 'a\n# b\n',
		after: '# b\na\n',
		move: up([1])
	}
];

describe('a top-level move keeps every line ended and the document’s final state (GH #587)', () => {
	it.each(TOP_LEVEL)('$label', async ({ before, after, move }) => {
		const h = makeTop(before);

		await move(h.reorder);

		expect(serialize(h.doc)).toBe(after);
		expectParseConverged(h.doc);
		await h.undo();
		expect(serialize(h.doc)).toBe(before);
	});
});

const IN_CONTAINER: {
	label: string;
	before: string;
	container: number[];
	after: string;
	move: Move;
}[] = [
	{
		label: 'the last list item moved up',
		before: '- a\n- b',
		container: [0],
		after: '- b\n- a',
		move: up([0, 1])
	},
	{
		label: 'the last list item moved up, CRLF',
		before: '- a\r\n- b',
		container: [0],
		after: '- b\r\n- a',
		move: up([0, 1])
	},
	{
		label: 'the first list item dropped at the tail',
		before: '- a\n- b',
		container: [0],
		after: '- b\n- a',
		move: drop([0, 0], 1)
	},
	{
		label: 'the last item of a list below prose moved up',
		before: 'x\n\n- a\n- b',
		container: [1],
		after: 'x\n\n- b\n- a',
		move: up([1, 1])
	},
	{
		label: 'a last item ending in a nested list moved up',
		before: '- a\n- b\n  - c',
		container: [0],
		after: '- b\n  - c\n- a',
		move: up([0, 1])
	},
	{
		label: 'the last quote child moved up',
		before: '> a\n>\n> b',
		container: [0],
		after: '> b\n>\n> a',
		move: up([0, 1])
	}
];

describe('a move inside a container that ends the document keeps its lines ended (GH #587)', () => {
	it.each(IN_CONTAINER)('$label', async ({ before, container, after, move }) => {
		const h = makeReorderContainer(before, { path: container });

		await move(h.reorder);

		expect(serialize(h.doc)).toBe(after);
		h.assertStable();
		await h.undo();
		expect(serialize(h.doc)).toBe(before);
	});
});
