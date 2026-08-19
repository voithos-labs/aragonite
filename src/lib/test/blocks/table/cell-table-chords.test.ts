// @vitest-environment jsdom
//
// The table's structural keyboard vocabulary end to end: a real keystroke on a real cell, and
// the document that came out. These chords are `tableCell` keymap bindings, so the planner can
// only be asked to DECLINE them (cell-keydown-plan.test.ts) and the behavior has to be pinned
// where it happens. Editor mount, because every arm commits and replaces the node.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, type MountedEditor } from '../editor-mount';
import { pressInCell } from './mount-table';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

// 3 rows × 2 columns; row 0 is the header, row 2 the last body row.
const GRID = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

describe('a chord in a cell mutates the table it names', () => {
	// [name, key init, cell pressed in, source after]
	const cases: Array<[string, KeyboardEventInit, [number, number], string]> = [
		[
			'Mod+Enter inserts a row below',
			{ key: 'Enter', ctrlKey: true },
			[1, 0],
			'| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n'
		],
		[
			'Mod+Shift+Enter inserts a row above',
			{ key: 'Enter', ctrlKey: true, shiftKey: true },
			[1, 0],
			'| A | B |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |\n'
		],
		[
			'Alt+Shift+ArrowRight inserts a column to the right',
			{ key: 'ArrowRight', altKey: true, shiftKey: true },
			[1, 0],
			'| A |  | B |\n| --- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |\n'
		],
		[
			'Alt+Shift+ArrowLeft inserts a column to the left',
			{ key: 'ArrowLeft', altKey: true, shiftKey: true },
			[1, 0],
			'|  | A | B |\n| --- | --- | --- |\n|  | 1 | 2 |\n|  | 3 | 4 |\n'
		],
		[
			'Mod+Shift+Backspace deletes the caret’s row',
			{ key: 'Backspace', ctrlKey: true, shiftKey: true },
			[1, 0],
			'| A | B |\n| --- | --- |\n| 3 | 4 |\n'
		],
		[
			'Alt+Shift+Backspace deletes the caret’s column',
			{ key: 'Backspace', altKey: true, shiftKey: true },
			[1, 0],
			'| B |\n| --- |\n| 2 |\n| 4 |\n'
		],
		[
			'Alt+ArrowDown moves the caret’s row down',
			{ key: 'ArrowDown', altKey: true },
			[1, 0],
			'| A | B |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |\n'
		],
		[
			'Alt+ArrowUp moves the caret’s row up',
			{ key: 'ArrowUp', altKey: true },
			[2, 0],
			'| A | B |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |\n'
		],
		[
			'Alt+ArrowRight moves the caret’s column right',
			{ key: 'ArrowRight', altKey: true },
			[1, 0],
			'| B | A |\n| --- | --- |\n| 2 | 1 |\n| 4 | 3 |\n'
		],
		[
			'Alt+ArrowLeft moves the caret’s column left',
			{ key: 'ArrowLeft', altKey: true },
			[1, 1],
			'| B | A |\n| --- | --- |\n| 2 | 1 |\n| 4 | 3 |\n'
		],
		[
			'Mod+Shift+A cycles the caret’s column alignment',
			{ key: 'A', ctrlKey: true, shiftKey: true },
			[1, 0],
			'| A | B |\n| :---: | --- |\n| 1 | 2 |\n| 3 | 4 |\n'
		]
	];

	for (const [name, init, [rowIdx, colIdx], after] of cases) {
		it(name, async () => {
			mounted = mountEditor({ source: GRID });

			await pressInCell(mounted!, rowIdx, colIdx, init);

			expect(mounted.source()).toBe(after);
		});
	}

	// Contrapositive: the reorder target declines at the boundary, so the chord must
	// neither displace the header nor push an undo entry.
	it('Alt+ArrowUp on the first body row leaves the table alone', async () => {
		mounted = mountEditor({ source: GRID });

		await pressInCell(mounted!, 1, 0, { key: 'ArrowUp', altKey: true });

		expect(mounted.source()).toBe(GRID);
	});

	// The caret's own cell, not row 0 / column 0: a chord indexed off the wrong coordinate hides
	// whenever the caret happens to be in the first cell.
	it('indexes the mutation off the caret’s own cell, not the first one', async () => {
		mounted = mountEditor({ source: GRID });

		await pressInCell(mounted!, 2, 1, { key: 'Enter', ctrlKey: true });

		expect(mounted.source()).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n|  |  |\n');
	});
});

describe('Mod+Alt+Arrow reorders the whole table among its siblings', () => {
	const DOC = `lead\n\n${GRID}`;

	function announcement(): string {
		return mounted!.target.querySelector('.editor-sr-live-reorder')?.textContent ?? '';
	}

	it('moves the table above its previous sibling', async () => {
		mounted = mountEditor({ source: DOC });

		await pressInCell(mounted!, 1, 0, { key: 'ArrowUp', ctrlKey: true, altKey: true }, [1]);

		expect(mounted.source()).toBe(`${GRID}\nlead\n`);
	});

	it('moves the table below its next sibling', async () => {
		mounted = mountEditor({ source: `${GRID}\ntail\n` });

		await pressInCell(mounted!, 1, 0, { key: 'ArrowDown', ctrlKey: true, altKey: true });

		expect(mounted.source()).toBe(`tail\n\n${GRID}`);
	});

	it('announces the move like every other kind’s reorder', async () => {
		mounted = mountEditor({ source: DOC });

		await pressInCell(mounted!, 1, 0, { key: 'ArrowUp', ctrlKey: true, altKey: true }, [1]);

		expect(announcement()).toBe('Moved block to position 1 of 2');
	});

	// The row reorder keeps the bare Alt gesture, so the two must not collide: the
	// same arrow with Mod added moves the block, without it moves the row.
	it('leaves the row reorder on the bare Alt chord', async () => {
		mounted = mountEditor({ source: DOC });

		await pressInCell(mounted!, 1, 0, { key: 'ArrowDown', altKey: true }, [1]);

		expect(mounted.source()).toBe(`lead\n\n| A | B |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |\n`);
	});

	it('is a no-op at the document boundary', async () => {
		mounted = mountEditor({ source: GRID });

		await pressInCell(mounted!, 1, 0, { key: 'ArrowUp', ctrlKey: true, altKey: true });

		expect(mounted.source()).toBe(GRID);
	});
});
