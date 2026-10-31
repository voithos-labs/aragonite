/**
 * What each conformance cell holds a plugin to, in one sentence, with the plugin-testing guide's
 * section that explains it. Every kit's failure message names the broken contract from here.
 */

import type { ConformanceCell } from './container-conformance';
import type { InlineConformanceCell } from './inline-conformance';
import type { KindCell } from './kind-conformance';

export interface CellContract {
	promise: string;
	/** A heading anchor in `docs/guide/plugin-testing.md`. */
	anchor: string;
}

const KIND = 'the-kind-checkup-runkindconformance';
const CONTAINER = 'the-container-checkup-runcontainerconformance';
const INLINE = 'the-inline-checkup-runinlinekindconformance';

export const KIND_CELL_CONTRACTS: Record<KindCell, CellContract> = {
	roundTrip: { promise: 'your fixture serializes back to its exact bytes', anchor: KIND },
	focus: { promise: 'a caret can enter and leave your block', anchor: KIND },
	mergeBackspace: {
		promise: 'Backspace merges into your block only as its mergeRole says',
		anchor: KIND
	},
	selectionPaint: { promise: 'a selection across your block paints what it covers', anchor: KIND },
	searchPaint: { promise: 'search finds the text your closure says it finds', anchor: KIND },
	reorder: { promise: 'moving your block moves its bytes whole', anchor: KIND },
	undo: { promise: 'one edit to your block is one undo step', anchor: KIND },
	clipboard: { promise: 'copying your block copies its bytes and nothing else', anchor: KIND },
	simOracle: { promise: "your block answers the editor's simulation", anchor: KIND },
	rawWrite: {
		promise: 'any bytes written into your block leave the blocks around it alone',
		anchor: KIND
	},
	unfinishedReading: {
		promise: 'an opener still waiting for its closer gives the document back when it closes',
		anchor: KIND
	}
};

export const CONTAINER_CELL_CONTRACTS: Record<ConformanceCell | 'coverageFloor', CellContract> = {
	coverageFloor: { promise: 'your profile asserts at least one cell', anchor: CONTAINER },
	localIndex: { promise: 'children are addressed by their index inside you', anchor: CONTAINER },
	ancestry: { promise: 'an edit deep inside rebuilds every container above it', anchor: CONTAINER },
	multiScope: {
		promise: 'one operation over two nesting levels is one undo step',
		anchor: CONTAINER
	},
	focusBubble: {
		promise: 'a caret leaving your top edge reaches the document once',
		anchor: CONTAINER
	},
	terminatorCollision: {
		promise: 'a body line spelled like your closing line stays inside you',
		anchor: CONTAINER
	},
	titleRow: { promise: 'typing in your title row leaves your metadata true', anchor: CONTAINER },
	openerLine: {
		promise: 'typing your opener above a block keeps the caret on a line it can type in',
		anchor: CONTAINER
	},
	declarations: {
		promise: 'your container declarations match what your parse and rebuild do',
		anchor: CONTAINER
	}
};

export const INLINE_CELL_CONTRACTS: Record<InlineConformanceCell, CellContract> = {
	claims: { promise: 'your recognizer claims every fixture you gave it', anchor: INLINE },
	roundTrip: {
		promise: 'your syntax, beside any other, serializes back to its exact bytes',
		anchor: INLINE
	},
	overlapDecline: { promise: 'you decline syntax the editor itself owns', anchor: INLINE },
	widget: { promise: 'your widget is one unit over exactly its bytes', anchor: INLINE },
	editingPolicy: {
		promise: 'your widget declares an editing policy the editor reads',
		anchor: INLINE
	},
	imageClaim: { promise: 'a recognizer building images can rewrite them', anchor: INLINE },
	registration: {
		promise: 'your recognizer is registered the way your profile says',
		anchor: INLINE
	}
};

/** One failed cell as a kit reports it: the cell, what went wrong, and the contract it breaks. */
export function cellFailure(cell: string, message: string, contract: CellContract): string {
	return `${cell}: ${message}\n    breaks: ${contract.promise} (plugin-testing.md#${contract.anchor})`;
}
