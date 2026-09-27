// One table cell mounted on its own over a stub `TableContext`, so a test reads what the cell
// asked its table for (`mount-table.ts` mounts the real table instead). Read-only questions and
// single gestures only: a commit replaces the node and nothing above re-renders with it.

import { vi } from 'vitest';
import TableCellBlock from '$lib/components/blocks/table/TableCellBlock.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { TableContext } from '$lib/action-contracts';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import type { EditorPolicies, EditorServices } from '$lib/editor-keys';
import { TABLE_CONTEXT_KEY } from '$lib/editor-keys';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { mountBlock } from '../../harness/mount-block';

/** A cell renders no decorations unless a test installs some. */
export const noIslands = {
	islandsForPath: () => [],
	blockDecorationsForPath: () => []
} as unknown as EditorServices['decorations'];

/** Every member spied, so a test names the one it means and `npm run check` fails
 *  when `TableContext` grows a member this stub would silently answer `undefined` for. */
export type StubTableContext = Record<keyof TableContext, ReturnType<typeof vi.fn>>;

function makeStubTableContext(): StubTableContext {
	return {
		focusCell: vi.fn(),
		getStickyColumn: vi.fn(() => null),
		setStickyColumn: vi.fn(),
		resetStickyColumn: vi.fn(),
		exitUpward: vi.fn(),
		exitDownward: vi.fn(),
		notifyCellFocused: vi.fn(),
		notifyCellBlurred: vi.fn(),
		insertRowAbove: vi.fn(),
		insertRowBelow: vi.fn(),
		insertColumnLeft: vi.fn(),
		insertColumnRight: vi.fn(),
		deleteRow: vi.fn(),
		deleteColumn: vi.fn(),
		moveRowUp: vi.fn(),
		moveRowDown: vi.fn(),
		reorderRowTo: vi.fn(),
		reorderColumnTo: vi.fn(),
		moveColumnLeft: vi.fn(),
		moveColumnRight: vi.fn(),
		cycleAlignment: vi.fn(),
		setColumnAlignment: vi.fn(),
		pasteGrid: vi.fn()
	};
}

export interface MountedCell {
	instance: BlockComponent & {
		runCommand(id: string): boolean;
		setSelection(start: number, end: number): void;
	};
	el: HTMLElement;
	blockEdit: ReturnType<typeof makeStubBlockEdit>;
	selection: ReturnType<typeof createSelectionState>;
	tableContext: StubTableContext;
	/** The cell's published reference, which is how the right-click menu reaches it. */
	ref(): BlockComponent;
	dispose(): Promise<void>;
}

/** The document `myPath` points into: a real 2x2 table holding this cell at [0, 1, 0]. Anything
 *  that reads its own target back out of the document, such as paste, resolves nothing without it. */
function documentAround(node: CstNode): Document {
	const doc = parse('| A | B |\n| --- | --- |\n| x | keep |\n');
	doc.children[0].children![1].children![0] = node;
	return doc;
}

/** The cell sits in the last row of a 2x2 table, so a vertical move exits the table. */
export function mountCell(raw: string, policies: Partial<EditorPolicies> = {}): MountedCell {
	const node: CstNode = { kind: 'tableCell', leadingTrivia: '', raw };
	const selection = createSelectionState();
	const tableContext = makeStubTableContext();
	const refs: (BlockComponent | undefined)[] = [];
	const doc = documentAround(node);
	const mounted = mountBlock(TableCellBlock, {
		doc,
		path: [0, 1, 0],
		props: { rowIdx: 1, columnCount: 2, rowCount: 2, slots: refSlotsOver(refs) },
		overrides: {
			policies,
			services: {
				decorations: noIslands,
				selection,
				widgetSelection: createWidgetSelectionState({ onSelect: () => {} })
			}
		},
		context: [[TABLE_CONTEXT_KEY, tableContext]]
	});
	// Nothing is stored, but the caret comes back through the cell's real write rule.
	const row = doc.children[0].children![1];
	vi.mocked(mounted.blockEdit.updateBlockContent).mockImplementation(
		(index, text, mode, caretBefore, caretAfter) => {
			const body = { children: row.children!, owner: row, lineEnding: '\n' as const };
			const write = legalizeWrite(body, index, text, mode);
			return withStoredCaret(Promise.resolve(), write.storedOffset(caretAfter ?? caretBefore ?? 0));
		}
	);
	return {
		instance: mounted.instance as MountedCell['instance'],
		el: mounted.target.querySelector('.table-cell') as HTMLElement,
		blockEdit: mounted.blockEdit,
		selection,
		tableContext,
		ref: () => refs[0]!,
		dispose: mounted.dispose
	};
}
