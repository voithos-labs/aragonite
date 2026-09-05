/**
 * The table's Enter completer: a lone header-shaped row completes into that header, the
 * canonical delimiter row and one empty body row, caret in the first body cell. Registered from
 * `core/parser.ts`, the guaranteed load path the built-in openers already ride.
 */

import type { CstNode } from '../nodes';
import { trimTrailingLineEnding } from '../lines';
import { registerBlockCompleter, type CompletionResult } from '../../schema/block-completions';
import { writeTableRow } from '../../schema/container-rebuilders';
import { tableHeaderCells } from './table';

// `parseTable` seats the header at child 0 and synthesizes the delimiter from metadata, so the
// first body row is child 1.
const FIRST_BODY_CELL = [1, 0];

/**
 * A leading pipe on top of the parser's row predicate: prose carries pipes too (`ls | grep foo`),
 * which the scan alone would take as a two-cell header. The predicate stays the outer bound — a
 * row it rejects never completes.
 */
export function tryCompleteTableRow(line: string): CompletionResult | null {
	if (!line.trim().startsWith('|')) return null;
	const cells = tableHeaderCells(line);
	if (!cells || cells.length < 2) return null;
	return {
		lines: [
			canonicalRow(cells),
			canonicalRow(cells.map(() => '---')),
			canonicalRow(cells.map(() => ''))
		],
		caret: { path: FIRST_BODY_CELL, line: 0, column: 0 }
	};
}

export function registerTableCompleter(): void {
	registerBlockCompleter('table', { tryComplete: tryCompleteTableRow });
}

/** Through the row rebuilder, so minted padding is the padding the serializer emits. The seam
 *  owns line endings, so the rebuilder's is trimmed back off. */
function canonicalRow(cells: string[]): string {
	const row: CstNode = {
		kind: 'tableRow',
		leadingTrivia: '',
		raw: '',
		metadata: { isHeader: false },
		children: cells.map((raw) => ({ kind: 'tableCell', leadingTrivia: '', raw }))
	};
	writeTableRow(row, '\n');
	return trimTrailingLineEnding(row.raw);
}
