// One table cell mounted BY ITSELF, over a stub table context. The contrast with `mount-table.ts`
// is which side of the cell/table boundary is under test: that harness mounts a real TableBlock so
// a gesture reaches the real coordination; this one stubs `TableContext` so the test reads what
// the cell ASKED its table for. Read-only questions and single gestures only — a commit replaces
// the node by copy-path-on-write and no parent re-renders this component with the replacement.

import { mount, unmount, flushSync } from 'svelte';
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

/** The document `myPath` addresses: a real 2x2 table holding this cell at [0, 1, 0]. A door
 *  that reads its own target back out of the document (paste) resolves nothing without it. */
function documentAround(node: CstNode): Document {
	const doc = parse('| A | B |\n| --- | --- |\n| x | keep |\n');
	doc.children[0].children![1].children![0] = node;
	return doc;
}

/** The last row of a 2x2 table, so a vertical move exits rather than staying inside. */
export function mountCell(raw: string, policies: Partial<EditorPolicies> = {}): MountedCell {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const node: CstNode = { kind: 'tableCell', leadingTrivia: '', raw };
	const blockEdit = makeStubBlockEdit();
	const selection = createSelectionState();
	const tableContext = makeStubTableContext();

	const doc = documentAround(node);
	const context = editorMountContext({
		blockEdit,
		policies,
		doc: { doc: () => doc },
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
			columnCount: 2,
			rowCount: 2,
			slots: refSlotsOver(refs)
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
