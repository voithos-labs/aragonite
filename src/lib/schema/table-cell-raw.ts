/**
 * The tableCell raw-write rule, declared on the kind as `normalizeRawWrite` and applied at the
 * write sink (`tree-operations/node-ops.updateNodeContent`). A cell's bytes are joined verbatim
 * into its row, and the parser truncates a row reparsing wider than the delimiter's column
 * count, so a bare `|` or line break reaching a cell raw deletes the last column's content.
 * Both passes are prefix-composable, which is what makes `escapedCellOffset` an exact caret image.
 */

/**
 * Escape every `|` not already freed by an odd run of backslashes. Idempotent: the freeing
 * backslash usually comes from text the writer never touched, so a re-run must be a no-op.
 */
export function escapeUnescapedPipes(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch !== '|') {
			out += ch;
			continue;
		}
		let backslashes = 0;
		for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) backslashes++;
		out += backslashes % 2 === 0 ? '\\|' : '|';
	}
	return out;
}

/** Text made legal as a cell's `raw`: no line break, no unescaped delimiter. */
export function normalizeCellRaw(raw: string): string {
	return escapeUnescapedPipes(raw.replace(/\r?\n/g, ' '));
}
