/**
 * The rule for writing a table cell's bytes, declared on the kind as `normalizeRawWrite`. A cell's
 * bytes go into its row unchanged, so a bare `|` or line break reaching them would split the row
 * and delete the last column's content. Both passes work prefix by prefix, which is what lets
 * `escapedCellOffset` (`components/blocks/table/table-cell-paste.ts`) map a caret exactly.
 */

/**
 * Escape every `|` an odd run of backslashes has not already escaped. Running it twice changes
 * nothing: the escaping backslash usually comes from text the writer never touched.
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
