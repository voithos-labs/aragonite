/**
 * The table cell's escape has one implementation. A cell's raw is joined verbatim into its row,
 * and the parser truncates a row that reparses wider than the delimiter's column count, so one
 * unescaped `|` silently deletes the last column's content. The content write applies the escape
 * and maps the caret (`content-write-caret`).
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const RULE_HOME = 'src/lib/schema/table-cell-raw.ts';

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('the tableCell escape has one implementation', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it.each([/\bnormalizeCellRaw\b/, /\bescapeUnescapedPipes\b/, /\bescapedCellOffset\b/])(
		'only the rule home names %s',
		(name) => {
			expect(namesInCode(sources, name)).toEqual([RULE_HOME]);
		}
	);
});
