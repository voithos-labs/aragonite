// @vitest-environment jsdom
// Every destructive gesture over a live range is one undo entry holding the document as it stood,
// and the replace puts one caret down (a command's block lands its own too).
// Miss-analysis: no suite counted the carets a gesture put down, or set a command key's removal
// over a grid beside Backspace's, and the composition rows pinned no caret at all.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { CURSOR_START } from '#lib/block-component.js';
import { cellPoint, type SelectionEndpoint } from '#lib/selection/primitives.js';
import { registerPasteTransform } from '#lib/tree-operations/paste/paste-transforms.js';
import { makeTableStateAt, stubBlockComponent } from '../../harness/editor-actions';
import { settleEditor } from '../../harness/settle';
import { makeEnv, makeHandlers, makeBeforeInputEvent } from './typed-char-env';
import { press } from './keydown-env';
import { ensurePasteSurface } from '#lib/test/harness/paste-surface.js';
import { tableCellPasteSurface } from '#lib/components/blocks/table/table-cell-paste.js';

type Gesture = 'Backspace' | 'cut' | 'type' | 'paste' | 'compose' | 'Enter' | 'Tab';
type Removal = Exclude<Gesture, 'Tab'>;

interface Shape {
	source: string;
	anchor: SelectionEndpoint;
	focus: SelectionEndpoint;
}

type Landed = [leafPath: number[], offset: number];
/** What a gesture leaves: the bytes, the replace's one landing, and a command's own landing when
 *  its block commits. */
type Outcome = [bytes: string, lands: Landed, commandLands?: Landed];

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
// table and clear a row's cells; a composition clears cells, elsewhere waiting where a key's text goes.
const OUTCOMES: Record<string, Record<Removal, Outcome>> = {
	'plain prose': {
		Backspace: ['alma\n', [[0], 2]],
		cut: ['alma\n', [[0], 2]],
		type: ['alxma\n', [[0], 3]],
		paste: ['alPma\n', [[0], 3]],
		compose: ['alma\n', [[0], 2]],
		Enter: ['al\n\nma\n', [[0], 2], [[1], CURSOR_START]]
	},
	'a rule held whole': {
		Backspace: [GONE, [[0], 4]],
		cut: [GONE, [[1], 0]],
		type: ['lead\n\nx\n\ntail\n', [[1], 1]],
		paste: ['lead\n\nP\n\ntail\n', [[1], 1]],
		// A composition's and Enter's place is the line a typed key's text takes: an empty paragraph
		// where the rule was.
		compose: ['lead\n\n\ntail\n', [[1], 0]],
		Enter: ['lead\n\n\ntail\n', [[1], 0]]
	},
	'a whole table': {
		Backspace: [GONE, [[0], 4]],
		cut: [GONE, [[1], 0]],
		type: ['lead\n\nx\n\ntail\n', [[1], 1]],
		paste: ['lead\n\nP\n\ntail\n', [[1], 1]],
		compose: [TABLE_CLEARED, [[1, 0, 0], 0]],
		Enter: ['lead\n\n\ntail\n', [[1], 0]]
	},
	'a whole row': {
		Backspace: [ROW_GONE, [[0, 1, 0], 0]],
		cut: [ROW_GONE, [[0, 1, 0], 0]],
		type: [rowWith('x'), [[0, 1, 0], 1]],
		paste: [rowWith('P'), [[0, 1, 0], 1]],
		compose: [ROW_CLEARED, [[0, 1, 0], 0]],
		Enter: [ROW_GONE, [[0, 1, 0], 0]]
	},
	'a whole column': {
		Backspace: [COLUMN_GONE, [[0, 0, 1], 0]],
		cut: [COLUMN_GONE, [[0, 0, 1], 0]],
		type: [columnWith('x'), [[0, 0, 1], 1]],
		paste: [columnWith('P'), [[0, 0, 1], 1]],
		compose: [COLUMN_CLEARED, [[0, 0, 1], 0]],
		Enter: [COLUMN_GONE, [[0, 0, 1], 0]]
	},
	'a cell rectangle': {
		Backspace: [GRID_CLEARED, [[0, 0, 0], 0]],
		cut: [GRID_CLEARED, [[0, 0, 0], 0]],
		type: [gridWith('x'), [[0, 0, 0], 1]],
		paste: [gridWith('P'), [[0, 0, 0], 1]],
		compose: [GRID_CLEARED, [[0, 0, 0], 0]],
		Enter: [GRID_CLEARED, [[0, 0, 0], 0]]
	}
};

async function perform(gesture: Gesture, shape: Shape, pasted = 'P') {
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
	else if (gesture === 'paste') await handlers.pasteOverRange({ text: pasted, plain: false });
	else handlers.handleCompositionStart();
	await settleEditor();
	return env;
}

const landedAt = (env: Awaited<ReturnType<typeof perform>>) =>
	env.landings.map((l) => [[...l.leafPath], l.offset]);

describe('a destructive gesture over a live range', () => {
	for (const [shapeName, shape] of Object.entries(SHAPES)) {
		for (const [gesture, [bytes, lands, commandLands]] of Object.entries(OUTCOMES[shapeName])) {
			it(`${gesture} over ${shapeName}: one undo entry, one landing`, async () => {
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

// Miss-analysis: the one composition row over a block held whole stood before a paragraph, whose
// text starts its line, so a caret moved past a heading's `# ` took the composed text into the heading.
describe('a composition over one block held whole right before a heading', () => {
	const BEFORE_HEADING: [string, string, number[], string][] = [
		['a rule', 'lead\n\n---\n\n# tail\n', [1], 'lead\n\n\n# tail\n'],
		['a rule that opens the document', '---\n\n## tail\n', [0], '\n## tail\n']
	];
	for (const [name, source, path, bytes] of BEFORE_HEADING)
		it(`${name}: the caret lands in an empty paragraph where the block was`, async () => {
			const env = await perform('compose', { source, anchor: whole(path), focus: whole(path) });

			expect(serialize(env.doc)).toBe(bytes);
			expect(landedAt(env)).toEqual([[path, 0]]);
		});
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

// A paste of nothing removes nothing, and a paste its transforms empty is a paste of nothing.
describe('a paste whose transforms leave nothing', () => {
	// Blocks, since one line after text goes in as text and no transform sees it.
	it('over prose: no write, no undo entry, no landing', async () => {
		registerPasteTransform({ name: 'drops-everything', transform: () => '' });
		const env = await perform('paste', SHAPES['plain prose'], 'P\n\nQ');

		expect(serialize(env.doc)).toBe(SHAPES['plain prose'].source);
		expect(env.deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(landedAt(env)).toEqual([]);
	});
});

// Miss-analysis: every row over a block held whole held a rule or a table, so none set a heading's
// or a code block's text beside the paragraph flush under it, where the key joined that paragraph.
describe('text over a heading or a code block the editor holds whole', () => {
	const HELD: [name: string, source: string][] = [
		['a heading flush over a paragraph', '# head\nlast\n'],
		['a code block flush over a paragraph', '```\ncode\n```\nlast\n']
	];
	for (const [name, source] of HELD) {
		const shape = { source, anchor: whole([0]), focus: whole([0]) };
		for (const gesture of ['type', 'paste'] as const)
			it(`${name}: ${gesture} takes its line, a blank line over the paragraph`, async () => {
				const env = await perform(gesture, shape, 'x');

				expect(serialize(env.doc)).toBe('x\n\nlast\n');
				expect(landedAt(env)).toEqual([[[0], 1]]);
			});
		it(`${name}: a composition waits in an empty paragraph where it was`, async () => {
			const env = await perform('compose', shape);

			expect(serialize(env.doc)).toBe('\nlast\n');
			expect(landedAt(env)).toEqual([[[0], 0]]);
		});
	}
});
