// @vitest-environment jsdom
// Text replacing a selected widget puts the caret right after itself, since the widget it replaced
// was the only thing selected and the browser keeps no caret of its own.
// Miss-analysis: GH #440, #441, the widget-splice tests pinned the commit's bytes, never the caret.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { replaceSelectedWidget } from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { CstNode } from '$lib/core/nodes';
import { fixtureReading, topLevelStore } from '../../harness/fixture-grammar';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { mountBodyRow } from '../../harness/editor-actions';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';

const SOURCE = 'lead![cat](x) tail\n';
const WIDGET = { start: 4, end: 13 };

function fixture() {
	const node: CstNode = parse(SOURCE).children[0];
	const log: string[] = [];
	let finishWrite = () => {};
	const widgetSelection = createWidgetSelectionState(createSelectionState());
	widgetSelection.select({ paragraphPath: [0], sourceStart: WIDGET.start, preSelectOffset: 2 });
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
		},
		widgetSelection,
		setPendingCursor: (offset: number | null) => void log.push(`caret ${offset}`),
		storedAs: () => topLevelStore(node)
	};
	return { deps, log, widgetSelection, finish: () => finishWrite() };
}

describe('replacing a selected widget', () => {
	it('sets the caret after the text before the write lands, and resolves after it', async () => {
		const { deps, log, widgetSelection, finish } = fixture();

		const replaced = replaceSelectedWidget(deps as never, WIDGET, 2, 'XY', 'authored');
		expect(log).toEqual(['write leadXY tail 2->6', 'caret 6']);
		expect(widgetSelection.getSelected()).toBeNull();

		finish();
		await replaced;
		expect(log.at(-1)).toBe('landed');
	});

	// The cell's rule escapes the typed pipe, so the caret goes after both bytes.
	it('parks the caret the write stored, past an escape the kind added', async () => {
		const row = mountBodyRow('| a | b |\n| - | - |\n| x<br>y | z |\n');
		const cell = () => row.deps.doc.children[0].children![1].children![0];
		const parked: (number | null)[] = [];
		const widgetSelection = createWidgetSelectionState(createSelectionState());
		widgetSelection.select({ paragraphPath: [0, 1, 0], sourceStart: 1, preSelectOffset: 1 });
		const deps = {
			get node() {
				return cell();
			},
			index: 0,
			blockEdit: row.blockEdit,
			widgetSelection,
			setPendingCursor: (offset: number | null) => void parked.push(offset),
			storedAs: () => storedAsAt(row.deps.doc, [0, 1, 0], fixtureReading())
		};

		await replaceSelectedWidget(deps, { start: 1, end: 5 }, 1, '|', 'authored');

		expect(cell().raw).toBe('x\\|y');
		expect(parked).toEqual([3]);
	});
});
