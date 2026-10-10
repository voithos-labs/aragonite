// @vitest-environment jsdom
// Every destructive gesture over a live range is one undo entry holding the document as it stood,
// and the replace puts one caret down (none for a composition; a command's block lands its own).
// Miss-analysis: no suite counted the carets a gesture put down, or set a command key's removal
// over a grid beside Backspace's.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { CURSOR_START } from '#lib/block-component.js';
import { cellPoint, type SelectionEndpoint } from '#lib/selection/primitives.js';
import { registerPasteTransform } from '#lib/tree-operations/paste/paste-transforms.js';
import { makeTableStateAt, stubBlockComponent } from '../../harness/editor-actions';
import { settleEditor } from '../../harness/settle';
import { makeEnv, makeHandlers, makeBeforeInputEvent, makePasteEvent } from './typed-char-env';
import { press } from './keydown-env';
import { ensurePasteSurface } from '#lib/test/support/paste-surface.js';
import { tableCellPasteSurface } from '#lib/components/blocks/table/table-cell-paste.js';

type Gesture = 'Backspace' | 'cut' | 'type' | 'paste' | 'compose' | 'Enter' | 'Tab';
type Removal = Exclude<Gesture, 'Tab'>;

interface Shape {
	source: string;
	anchor: SelectionEndpoint;
	focus: SelectionEndpoint;
}

type Landed = [leafPath: number[], offset: number];
/** What a gesture leaves: the bytes, the replace's one landing (null: none), and a command's own
 *  landing when its block commits. */
type Outcome = [bytes: string, lands: Landed | null, commandLands?: Landed];

const PROSE = 'alpha\n\nbeta\n\ngamma\n';
const RULE = 'lead\n\n---\n\ntail\n';
const TABLE = 'lead\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntail\n';
const ROWS = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
const GRID = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

const whole = (path: number[]): SelectionEndpoint => ({ path, wholeBlock: true });

const SHAPES: Record<string, Shape> = {
	'plain prose': {
		source: PROSE,
		anchor: { path: [0], offset: 2 },
		focus: { path: [2], offset: 3 }
	},
	'a rule held whole': { source: RULE, anchor: whole([1]), focus: whole([1]) },
	'a whole table': { source: TABLE, anchor: whole([1]), focus: whole([1]) },
	'a whole row': { source: ROWS, anchor: cellPoint([0], 2), focus: cellPoint([0], 3) },
	'a whole column': { source: GRID, anchor: cellPoint([0], 1), focus: cellPoint([0], 7) },
	'a cell rectangle': { source: GRID, anchor: cellPoint([0], 0), focus: cellPoint([0], 4) }
};

const GONE = 'lead\n\ntail\n';
const ROW_GONE = '| a | b |\n| --- | --- |\n| 3 | 4 |\n';
const rowWith = (cell: string) => `| a | b |\n| --- | --- |\n| ${cell} |  |\n| 3 | 4 |\n`;
const ROW_CLEARED = '| a | b |\n| --- | --- |\n|  |  |\n| 3 | 4 |\n';
const COLUMN_GONE = '| a | c |\n| --- | --- |\n| 1 | 3 |\n| 4 | 6 |\n';
const columnWith = (cell: string) =>
	`| a | ${cell} | c |\n| --- | --- | --- |\n| 1 |  | 3 |\n| 4 |  | 6 |\n`;
const COLUMN_CLEARED = '| a |  | c |\n| --- | --- | --- |\n| 1 |  | 3 |\n| 4 |  | 6 |\n';
const gridWith = (cell: string) =>
	`| ${cell} |  | c |\n| --- | --- | --- |\n|  |  | 3 |\n| 4 | 5 | 6 |\n`;
const GRID_CLEARED = '|  |  | c |\n| --- | --- | --- |\n|  |  | 3 |\n| 4 | 5 | 6 |\n';
const TABLE_CLEARED = 'lead\n\n|  |  |\n| --- | --- |\n|  |  |\n\ntail\n';

// Backspace, cut and command keys remove a whole table, row or column; typing and paste replace a
// table and clear a row's cells; a composition only clears.
const OUTCOMES: Record<string, Record<Removal, Outcome>> = {
	'plain prose': {
		Backspace: ['alma\n', [[0], 2]],
		cut: ['alma\n', [[0], 2]],
		type: ['alxma\n', [[0], 3]],
		paste: ['alPma\n', [[0], 3]],
		compose: ['alma\n', null],
		Enter: ['al\n\nma\n', [[0], 2], [[1], CURSOR_START]]
	},
	'a rule held whole': {
		Backspace: [GONE, [[0], 4]],
		cut: [GONE, [[1], 0]],
		type: ['lead\n\nx\n\ntail\n', [[1], 1]],
		paste: ['lead\n\nP\n\ntail\n', [[1], 1]],
		compose: [GONE, null],
		Enter: [GONE, [[0], 4]]
	},
	'a whole table': {
		Backspace: [GONE, [[0], 4]],
		cut: [GONE, [[1], 0]],
		type: ['lead\n\nx\n\ntail\n', [[1], 1]],
		paste: ['lead\n\nP\n\ntail\n', [[1], 1]],
		compose: [TABLE_CLEARED, null],
		Enter: [GONE, [[0], 4]]
	},
	'a whole row': {
		Backspace: [ROW_GONE, [[0, 1, 0], 0]],
		cut: [ROW_GONE, [[0, 1, 0], 0]],
		type: [rowWith('x'), [[0, 1, 0], 1]],
		paste: [rowWith('P'), [[0, 1, 0], 1]],
		compose: [ROW_CLEARED, null],
		Enter: [ROW_GONE, [[0, 1, 0], 0]]
	},
	'a whole column': {
		Backspace: [COLUMN_GONE, [[0, 0, 1], 0]],
		cut: [COLUMN_GONE, [[0, 0, 1], 0]],
		type: [columnWith('x'), [[0, 0, 1], 1]],
		paste: [columnWith('P'), [[0, 0, 1], 1]],
		compose: [COLUMN_CLEARED, null],
		Enter: [COLUMN_GONE, [[0, 0, 1], 0]]
	},
	'a cell rectangle': {
		Backspace: [GRID_CLEARED, [[0, 0, 0], 0]],
		cut: [GRID_CLEARED, [[0, 0, 0], 0]],
		type: [gridWith('x'), [[0, 0, 0], 1]],
		paste: [gridWith('P'), [[0, 0, 0], 1]],
		compose: [GRID_CLEARED, null],
		Enter: [GRID_CLEARED, [[0, 0, 0], 0]]
	}
};

async function perform(gesture: Gesture, shape: Shape) {
	// The cell's paste rules, which the editor registers with its built-in blocks.
	ensurePasteSurface(tableCellPasteSurface);
	const env = makeEnv(shape.source);
	const handlers = makeHandlers(env, [0]);
	// Every table is mounted, as one a range was drawn over is.
	env.doc.children.forEach((node, i) => {
		if (node.kind === 'table') makeTableStateAt(() => env.deps.doc, i);
	});
	// The paragraph the prose's Enter reaches splits where the removal left the caret.
	if (shape.source === PROSE) {
		env.deps.blockRefs[0] = stubBlockComponent({
			runCommand: (id) => id === 'block.split' && (void env.blockEdit.splitBlock(0, 2), true)
		});
	}
	env.selectionState.enterCrossBlock(shape.anchor, shape.focus);

	if (gesture === 'Backspace' || gesture === 'Enter' || gesture === 'Tab') {
		await handlers.handleKeyDown(press(gesture));
	} else if (gesture === 'cut') await handlers.performCrossBlockCut();
	else if (gesture === 'type') await handlers.handleBeforeInput(makeBeforeInputEvent('x'));
	else if (gesture === 'paste') await handlers.handlePaste(makePasteEvent('P'));
	else handlers.handleCompositionStart();
	await settleEditor();
	return env;
}

const landedAt = (env: Awaited<ReturnType<typeof perform>>) =>
	env.landings.map((l) => [[...l.leafPath], l.offset]);

describe('a destructive gesture over a live range', () => {
	for (const [shapeName, shape] of Object.entries(SHAPES)) {
		for (const [gesture, [bytes, lands, commandLands]] of Object.entries(OUTCOMES[shapeName])) {
			it(`${gesture} over ${shapeName}: one undo entry, ${lands ? 'one landing' : 'no landing'}`, async () => {
				const env = await perform(gesture as Gesture, shape);

				expect(serialize(env.doc)).toBe(bytes);
				const undo = env.deps.undoManager.getStacks().undo;
				expect(undo).toHaveLength(1);
				expect(serialize(undo[0].snapshot)).toBe(shape.source);
				expect(landedAt(env)).toEqual([lands, commandLands].filter(Boolean));
			});
		}
	}
});

// Tab indents what a range holds, and none of these holds a list item or a code line.
describe('Tab over a range with nothing to indent', () => {
	for (const [shapeName, shape] of Object.entries(SHAPES)) {
		it(`over ${shapeName}: no write, no undo entry, no landing`, async () => {
			const env = await perform('Tab', shape);

			expect(serialize(env.doc)).toBe(shape.source);
			expect(env.deps.undoManager.getStacks().undo).toHaveLength(0);
			expect(landedAt(env)).toEqual([]);
		});
	}
});

describe('a gesture whose insertion writes nothing lands at the removal’s caret', () => {
	it('a paste a transform empties, over prose', async () => {
		registerPasteTransform({ name: 'drops-everything', transform: () => '' });
		const env = await perform('paste', SHAPES['plain prose']);

		expect(serialize(env.doc)).toBe('alma\n');
		expect(landedAt(env)).toEqual([[[0], 2]]);
	});
});
