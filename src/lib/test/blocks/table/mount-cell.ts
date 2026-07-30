// One table cell mounted BY ITSELF, over a stub table context.
//
// The contrast with `mount-table.ts` is which side of the cell/table boundary is
// under test. That harness mounts a real TableBlock so a gesture reaches the real
// coordination; this one stubs `TableContext` so the test reads what the cell ASKED
// its table for, without the table's own logic standing between the two. A cell that
// stops asking, or asks for the wrong coordinate, is invisible through a real table
// whose answer happens to look the same.
//
// Read-only questions and single gestures only, for the same reason `mount-table.ts`
// says so: a commit replaces the node by copy-path-on-write and no parent re-renders
// this component with the replacement.

import { mount, unmount, flushSync } from 'svelte';
import { vi } from 'vitest';
import TableCellBlock from '$lib/components/blocks/table/TableCellBlock.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { TableContext } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import type { EditorServices } from '$lib/editor-keys';
import { TABLE_CONTEXT_KEY } from '$lib/editor-keys';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

/** A cell renders no decoration islands unless a test installs some. */
const noIslands = { islandsForPath: () => [] } as unknown as EditorServices['decorations'];

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
		setColumnAlignment: vi.fn()
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
	/** The cell's published ref slot — the channel the right-click menu reaches it through. */
	ref(): BlockComponent;
	dispose(): Promise<void>;
}

/** The last row of a 2x2 table, so a vertical move exits rather than staying inside. */
export function mountCell(raw: string): MountedCell {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const node: CstNode = { kind: 'tableCell', leadingTrivia: '', raw };
	const blockEdit = makeStubBlockEdit();
	const selection = createSelectionState();
	const tableContext = makeStubTableContext();

	const context = editorMountContext({
		blockEdit,
		doc: { doc: () => ({ kind: 'document', prefix: '', children: [node], suffix: '' }) },
		services: {
			decorations: noIslands,
			selection,
			widgetSelection: createWidgetSelectionState({ onSelect: () => {} })
		}
	});
	context.set(TABLE_CONTEXT_KEY, tableContext);

	const refs: (BlockComponent | undefined)[] = [];
	const instance = mount(TableCellBlock, {
		target,
		props: {
			node,
			index: 0,
			myPath: [0, 1, 0],
			rowIdx: 1,
			colIdx: 0,
			columnCount: 2,
			rowCount: 2,
			setRef: (i: number, r: BlockComponent | undefined) => {
				refs[i] = r;
			},
			getRef: (i: number) => refs[i]
		},
		context
	});
	flushSync();

	return {
		instance: instance as MountedCell['instance'],
		el: target.querySelector('.table-cell') as HTMLElement,
		blockEdit,
		selection,
		tableContext,
		ref: () => refs[0]!,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}
