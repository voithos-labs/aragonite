// @vitest-environment jsdom
// Text replacing a selected widget puts the caret right after itself, since the widget it replaced
// was the only thing selected and the browser keeps no caret of its own.
// Miss-analysis: GH #440, #441, the widget-splice tests pinned the commit's bytes, never the caret.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { replaceSelectedWidget } from '#lib/components/blocks/text/widget-interaction.js';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import type { CstNode } from '#lib/core/nodes.js';
import { fixtureReading, topLevelStore } from '../../harness/fixture-grammar';
import { storedAsAt } from '#lib/tree-operations/stored-as.js';
import { mountBodyRow } from '../../harness/editor-actions';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { createSurfaceWrite, rangeWrite } from '#lib/components/blocks/surface-write.js';
import type { BlockEditActions } from '#lib/action-contracts.js';
import type { LeafRangeEdit } from '#lib/tree-operations/leaf-range.js';
import type { NodeView } from '#lib/core/node-views.js';
import { createInsertionRecords } from '#lib/caret/next-insertion.js';

const NO_CUE = { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} };

/** The write a key over a selected widget makes, anchored where the widget was selected from. */
function keyWrite(
	getNode: () => NodeView,
	blockEdit: BlockEditActions,
	requestCaret: (at: number) => void,
	anchor: number
) {
	const writeText = createSurfaceWrite({
		getNode,
		getIndex: () => 0,
		getPath: () => [0],
		blockEdit,
		kindCue: NO_CUE,
		getPreEditOffset: () => -1,
		requestCaret,
		holdInsertion: () => createInsertionRecords([]).hold({}, null)
	});
	return (edit: LeafRangeEdit) =>
		writeText({
			...rangeWrite(edit),
			intent: 'typed',
			mode: 'authored',
			source: 'widget',
			sessionAnchor: anchor
		});
}

const SOURCE = 'lead![cat](x) tail\n';
const WIDGET = { start: 4, end: 13 };

function fixture() {
	const node: CstNode = parse(SOURCE).children[0];
	const log: string[] = [];
	let finishWrite = () => {};
	const selection = createSelectionState();
	selectWidgetWhole(selection, {
		paragraphPath: [0],
		sourceStart: WIDGET.start,
		preSelectOffset: 2
	});
	const deps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		blockEdit: {
			completeLineOnType: async () => false,
			updateBlockContent: (
				_: number,
				raw: string,
				_mode: string,
				before: number,
				after: number
			) => {
				log.push(`write ${raw.trimEnd()} ${before}->${after}`);
				const done = new Promise<boolean>((resolve) => {
					finishWrite = () => {
						log.push('landed');
						resolve(true);
					};
				});
				return withStoredCaret(done, after);
			}
		} as unknown as BlockEditActions,
		selection,
		storedAs: () => topLevelStore(node)
	};
	const write = keyWrite(
		() => node,
		deps.blockEdit,
		(at) => void log.push(`caret ${at}`),
		2
	);
	return { deps, write, log, selection, finish: () => finishWrite() };
}

describe('replacing a selected widget', () => {
	it('sets the caret after the text before the write lands, and resolves after it', async () => {
		const { deps, write, log, selection, finish } = fixture();

		const replaced = replaceSelectedWidget(deps, WIDGET, 'XY', write);
		expect(log).toEqual(['write leadXY tail 2->6', 'caret 6']);
		expect(selection.widget).toBeNull();

		finish();
		await replaced;
		expect(log.at(-1)).toBe('landed');
	});

	// The cell's rule escapes the typed pipe, so the caret goes after both bytes.
	it('parks the caret the write stored, past an escape the kind added', async () => {
		const row = mountBodyRow('| a | b |\n| - | - |\n| x<br>y | z |\n');
		const cell = () => row.deps.doc.children[0].children![1].children![0];
		const parked: (number | null)[] = [];
		const selection = createSelectionState();
		selectWidgetWhole(selection, { paragraphPath: [0, 1, 0], sourceStart: 1, preSelectOffset: 1 });
		const deps = {
			get node() {
				return cell();
			},
			selection,
			storedAs: () => storedAsAt(row.deps.doc, [0, 1, 0], fixtureReading())
		};
		const write = keyWrite(cell, row.blockEdit, (at) => void parked.push(at), 1);

		await replaceSelectedWidget(deps, { start: 1, end: 5 }, '|', write);

		expect(cell().raw).toBe('x\\|y');
		expect(parked).toEqual([3]);
	});
});
