/**
 * The tableCell raw-write rule, declared on the kind as `normalizeRawWrite` and
 * applied at the write sink (`tree-operations/node-ops.updateNodeContent`).
 *
 * A cell's bytes are joined verbatim into its row (`rebuildTableRowRaw`) and the
 * parser truncates a row that reparses wider than the delimiter's column count,
 * so a bare `|` or a line break reaching a cell raw silently deletes the last
 * column's content. Living here rather than beside the cell component is what
 * lets the sink and find/replace read the same rule without either importing a
 * renderer.
 *
 * Both passes are prefix-composable — each character's output depends only on
 * characters before it — which is what makes `escapedCellOffset` an exact caret
 * image of the whole normalization rather than an approximation of it.
 */

/**
 * Escape every `|` not already freed by an odd run of backslashes. Deliberately
 * whole-raw and idempotent: the backslash that frees a `|` usually comes from
 * text the writer never touched, so re-running over an already-escaped raw must
 * be a no-op.
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
