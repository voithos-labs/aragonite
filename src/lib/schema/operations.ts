/**
 * The one list of structural operations: `OperationKind`, `OpDescriptor` and `EditEvent` all come
 * from `OperationDetailMap`, so a mismatch is a compile error rather than an edit someone missed
 * in one place.
 */

export interface OperationDetailMap {
	split: { at: number; itemIndex?: number; innerIndex?: number };
	merge: { direction: 'prev' | 'next' };
	reorder: { from: number; to: number };
	delete: { crossBlock?: true; table?: 'whole' } | undefined;
	input: { byteLength: number };
	/** `crossBlock` marks a write that also covered the range's other blocks: `path` names one
	 *  block, as every operation does, and `length` is that block's. `delete` reads the same way. An
	 *  endpoint carrying a cell index names its table, whose own bytes no write holds, so `length`
	 *  is the table's length before the write; a full path to a cell names it like any block. */
	updateContent: { length: number; crossBlock?: true };
	replaceBlock:
		| { count: number }
		| {
				action: 'indentItem' | 'promoteNestedItem';
				itemIndex?: number;
				parentItemIdx?: number;
				nestedItemIdx?: number;
		  }
		| {
				source:
					| 'paste-dispatch'
					| 'paste-dispatch-table-cell'
					| 'cross-block-covered-block'
					| 'selection-drop';
		  };
	paste:
		| { count: number }
		| {
				source:
					| 'list-absorb'
					| 'list-break-out'
					| 'container-matching'
					| 'container-matching-merge'
					| 'container-matching-merge-singleton';
				listPath?: number[];
				outerPath?: number[];
		  };
	appendBlock: { itemIndex?: number } | undefined;
	/** Insert at an index inside the list; `appendBlock`'s sibling for a block created between two. */
	insertBlock: undefined;
	metadataUpdate: { fields: string[] };
	undo: undefined;
	redo: undefined;
	tableInsertRow: { rowIdx: number; side: 'above' | 'below' };
	tableDeleteRow: { rowIdx: number; crossBlock?: true };
	tableInsertColumn: { colIdx: number; side: 'left' | 'right' };
	/** A grid pasted from `rowIdx`/`colIdx`, the table grown to hold it. */
	tablePasteGrid: { rowIdx: number; colIdx: number; rows: number; cols: number };
	tableDeleteColumn: { colIdx: number; crossBlock?: true };
	tableReorderRow: { from: number; to: number };
	tableReorderColumn: { from: number; to: number };
	tableCycleAlignment: { colIdx: number };
	tableSetAlignment: { colIdx: number };
}

import type { DocPath } from '../selection/path-math';

export type OperationKind = keyof OperationDetailMap;

/** Correlated kind↔detail pair; detail is optional only where the map allows undefined. */
export type OpDescriptor = {
	[K in OperationKind]: undefined extends OperationDetailMap[K]
		? { kind: K; detail?: OperationDetailMap[K] }
		: { kind: K; detail: OperationDetailMap[K] };
}[OperationKind];

/**
 * `OpDescriptor` plus the document-absolute path that container and multi-list commits carry.
 * `eventPath` is a `DocPath` so the code that builds it cannot fall back to a plain `number[]`.
 */
export type ScopedOpDescriptor = OpDescriptor & { eventPath: DocPath };
