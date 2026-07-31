// A whole table mounted from Markdown — TableBlock over real TableRowBlock and
// TableCellBlock children, so a gesture in a cell reaches the table context the
// way it does in the editor. Bare-cell mounts (cell-write-escape, cell-reveal-
// caret) stub that context; these tests are about what the table does with it.

import { mount, unmount, flushSync, tick } from 'svelte';
import TableBlock from '$lib/components/blocks/table/TableBlock.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { CstNode, Document } from '$lib/core/nodes';
import type { FocusActions } from '$lib/action-contracts';
import type { StickyColumnState } from '$lib/cursor/sticky-column';
import { parse } from '$lib/core/parser';
import { makeStickyColumn, makeStubFocus } from '../../harness/editor-actions';
import { editorMountContext, type MountContextOverrides } from '../../harness/mount-context';

/** jsdom implements neither the caret geometry an exit gesture measures nor a windowed scope's
 *  observer. Range rect measurement THROWS, so an exit without this takes down the handler. */
export function installTableLayoutStubs(): () => void {
	const rangeRects = Range.prototype.getClientRects;
	const rangeBox = Range.prototype.getBoundingClientRect;
	Range.prototype.getClientRects = () =>
		({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
	return () => {
		Range.prototype.getClientRects = rangeRects;
		Range.prototype.getBoundingClientRect = rangeBox;
	};
}

export interface MountedTable {
	doc: Document;
	/** Live read: a structural commit replaces the node by copy-path-on-write, so
	 *  a captured reference goes stale on the first mutation. */
	readonly table: CstNode;
	/** The `[role="table"]` grid element. */
	el: HTMLElement;
	/** TableBlock's own BlockComponent surface. */
	block: BlockComponent & {
		measurePartialRects(start: number, end: number): DOMRect[];
		cellRect(rowIdx: number, colIdx: number): DOMRect | null;
		mountedRowWindow(): { start: number; end: number };
	};
	focus: FocusActions;
	stickyColumn: StickyColumnState;
	cell(rowIdx: number, colIdx: number): HTMLElement;
	dispose: () => Promise<void>;
}

/** Mount the table parsed from `source` at document index 0. Read-only questions only — a
 *  COMMIT needs a real parent to re-render with the replaced node (`blocks/editor-mount.ts`). */
export function mountTable(source: string, overrides: MountContextOverrides = {}): MountedTable {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse(source);
	const focus = overrides.focus ?? makeStubFocus();
	const stickyColumn = overrides.services?.stickyColumn ?? makeStickyColumn();
	const instance = mount(TableBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({
			...overrides,
			focus,
			doc: { doc: () => doc, ...overrides.doc },
			services: { ...overrides.services, stickyColumn }
		})
	});
	flushSync();
	const el = target.querySelector('[role="table"]') as HTMLElement;
	return {
		doc,
		get table() {
			return doc.children[0];
		},
		el,
		block: instance as MountedTable['block'],
		focus,
		stickyColumn,
		cell: (rowIdx, colIdx) => {
			const row = el.querySelector(`:scope > [data-table-row-idx="${rowIdx}"]`);
			const cells = row?.querySelectorAll(':scope > .table-cell');
			const found = cells?.[colIdx] as HTMLElement | undefined;
			if (!found) throw new Error(`no mounted cell at ${rowIdx},${colIdx}`);
			return found;
		},
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

/** A keydown on `el`; the cell's handler awaits its widget intercepts first. */
export async function press(el: HTMLElement, init: KeyboardEventInit): Promise<void> {
	el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
	for (let i = 0; i < 10; i++) await tick();
}
