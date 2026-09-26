/**
 * The rule for writing a table cell's bytes, declared on the kind as `rawWrite`. A cell's bytes
 * go into its row unchanged, so a bare `|` or line break reaching them would split the row and
 * delete the last column's content. Both passes work prefix by prefix, which is what lets
 * {@link escapedCellOffset} map a caret exactly.
 */

import type { WriteRule } from './block-kind-descriptor';

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

/**
 * Where `offset` lands once {@link normalizeCellRaw} has run, worked out by that same pass over
 * the prefix, so the caret cannot drift out of step with the bytes.
 */
export function escapedCellOffset(text: string, offset: number): number {
	return normalizeCellRaw(text.slice(0, offset)).length;
}

/** The cell's write rule; it reads nothing but the bytes. */
export const tableCellWrite: WriteRule = {
	normalize: (raw) => normalizeCellRaw(raw),
	mapOffset: (raw, offset) => escapedCellOffset(raw, offset)
};
