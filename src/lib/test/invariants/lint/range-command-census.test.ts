/**
 * G4.50 — the cross-block sets are hand-maintained, so a new block command answers the range
 * question in exactly one of three ways: declined outright, routed to the cross-block arm, or
 * recorded as range-safe with the reason. An id in no table fails here the day it is minted,
 * rather than at the audit that finds the door and the chord path disagreeing under a range.
 */

import { describe, it, expect } from 'vitest';
import {
	BLOCK_COMMAND_IDS,
	CROSS_BLOCK_RANGE_COMMAND_IDS,
	RANGE_DECLINED_COMMAND_IDS
} from '$lib/schema/commands';

/**
 * Ids whose arm does NOT spend one block's own offsets, and why. An arm that reads the focused
 * block's caret or selection and writes that block's bytes belongs in the decline set instead.
 */
const RANGE_SAFE: Record<string, string> = {
	// The cross-block keydown arm deletes the range and redispatches, so the arm never runs
	// against a live one — and through the door the split is the caller's stated intent.
	'block.split': 'range deleted first by the cross-block arm; the door split is intentional',
	'block.hardBreak': 'inserts at the caret the range collapses to, never across the range',
	'block.insertTab': 'inserts one byte at the caret; declines inside a list item',
	'block.mergePrev': 'structural: joins two blocks, no offsets of its own to spend',
	'block.mergeNext': 'structural: joins two blocks, no offsets of its own to spend',
	'block.moveUp': 'reorders a whole unit; offsets are not part of the operation',
	'block.moveDown': 'reorders a whole unit; offsets are not part of the operation',
	'heading.cycle': 'rewrites the block CONTENT RANGE, which no cross-block range narrows',
	'code.newline': 'fence-body edit at the caret inside one code block',
	'code.indent': 'fence-body edit over whole lines, not the painted range',
	'code.dedent': 'fence-body edit over whole lines, not the painted range',
	'code.backspace': 'fence-body edit at the caret inside one code block',
	'code.delete': 'fence-body edit at the caret inside one code block',
	'list.indent': 'structural: re-parents a list item',
	'list.unindent': 'structural: re-parents a list item',
	'cell.enter': 'grid navigation, or a row insert; spends no cell offsets',
	'cell.tab': 'grid navigation between cells',
	'cell.shiftTab': 'grid navigation between cells',
	'table.insertRowBelow': 'grid structure, addressed by row index',
	'table.insertRowAbove': 'grid structure, addressed by row index',
	'table.insertColumnRight': 'grid structure, addressed by column index',
	'table.insertColumnLeft': 'grid structure, addressed by column index',
	'table.deleteRow': 'grid structure, addressed by row index',
	'table.deleteColumn': 'grid structure, addressed by column index',
	'table.moveRowUp': 'grid structure, addressed by row index',
	'table.moveRowDown': 'grid structure, addressed by row index',
	'table.moveColumnLeft': 'grid structure, addressed by column index',
	'table.moveColumnRight': 'grid structure, addressed by column index',
	'table.cycleAlignment': 'grid metadata, addressed by column index',
	'chrome.descendToBody': 'focus move into a container body'
};

const classifications = (id: string): number =>
	(RANGE_DECLINED_COMMAND_IDS.has(id) ? 1 : 0) +
	(CROSS_BLOCK_RANGE_COMMAND_IDS.has(id) ? 1 : 0) +
	(RANGE_SAFE[id] === undefined ? 0 : 1);

describe('G4.50 every block command answers the cross-block range question', () => {
	it('classifies the whole vocabulary exactly once each', () => {
		expect(
			BLOCK_COMMAND_IDS.filter((id) => classifications(id) === 0),
			'a new block command joins RANGE_DECLINED_COMMAND_IDS (one block’s own selection, ' +
				'no cross-block reading), CROSS_BLOCK_RANGE_COMMAND_IDS (the same shape with an arm ' +
				'behind it), or the RANGE_SAFE table above, with the reason'
		).toEqual([]);
		expect(BLOCK_COMMAND_IDS.filter((id) => classifications(id) > 1)).toEqual([]);
	});

	// Both tables shrink only through the vocabulary: an id removed from BLOCK_COMMAND_IDS and
	// left behind here would keep a decline alive for a command nobody can dispatch.
	it('names no id the vocabulary no longer carries', () => {
		const vocabulary = new Set<string>(BLOCK_COMMAND_IDS);
		const named = [
			...RANGE_DECLINED_COMMAND_IDS,
			...CROSS_BLOCK_RANGE_COMMAND_IDS,
			...Object.keys(RANGE_SAFE)
		];
		expect(named.filter((id) => !vocabulary.has(id))).toEqual([]);
	});

	// Non-vacuity: the census must actually fail on an unclassified id, not merely on an empty set.
	it('flags an id classified nowhere', () => {
		const vocabulary = [...BLOCK_COMMAND_IDS, 'block.inventedForThisCase'];
		expect(vocabulary.filter((id) => classifications(id) === 0)).toEqual([
			'block.inventedForThisCase'
		]);
	});
});
