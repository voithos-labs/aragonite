// @vitest-environment jsdom
// Every destructive gesture over a live range is one undo entry holding the document as it stood,
// and puts one caret down through the caret landing; a composition puts none, since the IME owns it.
// Miss-analysis: each gesture had its own suite over its own shapes, and none read where the caret
// landed or whether the shape removed under one key was removed under the others.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { CURSOR_EXACT_START } from '$lib/block-component';
import { cellPoint, type SelectionEndpoint } from '$lib/selection/primitives';
import { stubBlockComponent } from '../../harness/editor-actions';
import { settleEditor } from '../../harness/settle';
import { makeEnv, makeHandlers, makeBeforeInputEvent, makePasteEvent } from './typed-char-env';
import { press } from './keydown-env';

type Gesture = 'Backspace' | 'cut' | 'type' | 'paste' | 'compose' | 'Enter';

interface Shape {
	source: string;
	anchor: SelectionEndpoint;
	focus: SelectionEndpoint;
}

/** What a gesture leaves: the bytes, and the leaf and offset the caret lands at (null: none). */
type Outcome = [bytes: string, lands: [leafPath: number[], offset: number] | null];

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
	'a cell rectangle': { source: GRID, anchor: cellPoint([0], 0), focus: cellPoint([0], 4) }
};

const GONE = 'lead\n\ntail\n';
const ROW_GONE = '| a | b |\n| --- | --- |\n| 3 | 4 |\n';
const rowWith = (cell: string) => `| a | b |\n| --- | --- |\n| ${cell} |  |\n| 3 | 4 |\n`;
const ROW_CLEARED = '| a | b |\n| --- | --- |\n|  |  |\n| 3 | 4 |\n';
const gridWith = (cell: string) =>
	`| ${cell} |  | c |\n| --- | --- | --- |\n|  |  | 3 |\n| 4 | 5 | 6 |\n`;
const GRID_CLEARED = '|  |  | c |\n| --- | --- | --- |\n|  |  | 3 |\n| 4 | 5 | 6 |\n';
const TABLE_CLEARED = 'lead\n\n|  |  |\n| --- | --- |\n|  |  |\n\ntail\n';

const OUTCOMES: Record<string, Record<Gesture, Outcome>> = {
	'plain prose': {
		Backspace: ['alma\n', [[0], 2]],
		cut: ['alma\n', [[0], 2]],
		type: ['alxma\n', [[0], 3]],
		paste: ['alPma\n', [[0], 3]],
		compose: ['alma\n', null],
		Enter: ['al\n\nma\n', [[1], CURSOR_EXACT_START]]
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
		Enter: [TABLE_CLEARED, [[1, 0, 0], 0]]
	},
	'a whole row': {
		Backspace: [ROW_GONE, [[0, 1, 0], 0]],
		cut: [ROW_GONE, [[0, 1, 0], 0]],
		type: [rowWith('x'), [[0, 1, 0], 1]],
		paste: [rowWith('P'), [[0, 1, 0], 1]],
		compose: [ROW_CLEARED, null],
		Enter: [ROW_CLEARED, [[0, 1, 0], 0]]
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
	const env = makeEnv(shape.source);
	const handlers = makeHandlers(env, [0]);
	// The paragraph the prose's Enter reaches splits where the removal left the caret.
	if (shape.source === PROSE) {
		env.deps.blockRefs[0] = stubBlockComponent({
			runCommand: (id) => id === 'block.split' && (void env.blockEdit.splitBlock(0, 2), true)
		});
	}
	env.selectionState.enterCrossBlock(shape.anchor, shape.focus);

	if (gesture === 'Backspace') await handlers.handleKeyDown(press('Backspace'));
	else if (gesture === 'Enter') await handlers.handleKeyDown(press('Enter'));
	else if (gesture === 'cut') await handlers.performCrossBlockCut();
	else if (gesture === 'type') await handlers.handleBeforeInput(makeBeforeInputEvent('x'));
	else if (gesture === 'paste') await handlers.handlePaste(makePasteEvent('P'));
	else handlers.handleCompositionStart();
	await settleEditor();
	return env;
}

describe('a destructive gesture over a live range', () => {
	for (const [shapeName, shape] of Object.entries(SHAPES)) {
		for (const [gesture, [bytes, lands]] of Object.entries(OUTCOMES[shapeName])) {
			it(`${gesture} over ${shapeName}: one undo entry, ${lands ? 'one landing' : 'no landing'}`, async () => {
				const env = await perform(gesture as Gesture, shape);

				expect(serialize(env.doc)).toBe(bytes);
				const undo = env.deps.undoManager.getStacks().undo;
				expect(undo).toHaveLength(1);
				expect(serialize(undo[0].snapshot)).toBe(shape.source);
				const last = env.landings.at(-1);
				if (lands === null) expect(env.landings).toEqual([]);
				else expect(last && [[...last.leafPath], last.offset]).toEqual(lands);
			});
		}
	}
});

describe('cut removes what Backspace removes', () => {
	for (const shapeName of ['a whole table', 'a whole row', 'a cell rectangle']) {
		it(`over ${shapeName}`, async () => {
			const shape = SHAPES[shapeName];
			const cut = await perform('cut', shape);
			const backspace = await perform('Backspace', shape);

			expect(serialize(cut.doc)).toBe(serialize(backspace.doc));
		});
	}
	it('over a whole column', async () => {
		const column = { source: GRID, anchor: cellPoint([0], 1), focus: cellPoint([0], 7) };
		const cut = await perform('cut', column);

		expect(serialize(cut.doc)).toBe('| a | c |\n| --- | --- |\n| 1 | 3 |\n| 4 | 6 |\n');
	});
});
