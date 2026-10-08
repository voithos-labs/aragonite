/**
 * The table's Enter completer: a lone header-shaped row completes into that header, the
 * canonical delimiter row and one empty body row, caret in the first body cell. Registered from
 * `core/parser.ts`, the guaranteed load path the built-in openers already ride.
 */

import { trimWhitespace } from '../lines';
import { registerBlockCompleter, type CompletionResult } from '../../schema/block-completions';
import { tableHeaderCells } from './table';
import { newTableLines } from './table-line';

// `parseTable` puts the header at child 0 and synthesizes the delimiter from metadata, so the
// first body row is child 1.
const FIRST_BODY_CELL = [1, 0];

/** Requires a leading pipe on top of the row predicate, since prose carries pipes too
 *  (`ls | grep foo`); a row the predicate rejects never completes. */
export function tryCompleteTableRow(line: string): CompletionResult | null {
	if (!trimWhitespace(line).startsWith('|')) return null;
	const cells = tableHeaderCells(line);
	if (!cells || cells.length < 2) return null;
	return {
		lines: newTableLines(cells, 1),
		caret: { path: FIRST_BODY_CELL, line: 0, column: 0 }
	};
}

export function registerTableCompleter(): void {
	registerBlockCompleter('table', { tryComplete: tryCompleteTableRow });
}
