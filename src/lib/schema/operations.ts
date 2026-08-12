/**
 * Single source of truth for the structural-operation vocabulary: `OperationKind`,
 * `OpDescriptor`, and `EditEvent` all derive from `OperationDetailMap`, so drift is a compile
 * error rather than a one-place-missed edit.
 */

export interface OperationDetailMap {
	split: { at: number; itemIndex?: number; innerIndex?: number };
	merge: { direction: 'prev' | 'next' };
	reorder: { from: number; to: number };
	delete: { crossBlock?: true; table?: 'whole' } | undefined;
	input: { byteLength: number };
	updateContent: { length: number };
	replaceBlock:
		| { count: number }
		| {
				action: 'indentItem' | 'promoteNestedItem';
				itemIndex?: number;
				parentItemIdx?: number;
				nestedItemIdx?: number;
		  }
		| { source: 'paste-dispatch' | 'paste-dispatch-table-cell' | 'cross-block-paste-whole-table' };
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
	/** Insert at an interior index; `appendBlock`'s sibling for a block minted BETWEEN two. */
	insertBlock: undefined;
	metadataUpdate: { fields: string[] };
	undo: undefined;
	redo: undefined;
	tableInsertRow: { rowIdx: number; side: 'above' | 'below' };
	tableDeleteRow: { rowIdx: number; crossBlock?: true };
	tableInsertColumn: { colIdx: number; side: 'left' | 'right' };
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
 * OpDescriptor plus the doc-absolute event path container/multi-scope commits carry. `eventPath`
 * is `DocPath` so the op families composing it can't decay to a raw `number[]`.
 */
export type ScopedOpDescriptor = OpDescriptor & { eventPath: DocPath };
