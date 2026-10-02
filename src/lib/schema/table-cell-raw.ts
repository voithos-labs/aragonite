/**
 * The rule for writing a table cell's bytes, declared on the kind as `rawWrite`. A cell's bytes
 * go into its row unchanged, so a bare `|` or line break reaching them would split the row and
 * delete the last column's content. Both passes work prefix by prefix, which is what lets
 * {@link escapedCellOffset} map a caret exactly.
 */

import { trimTrailingLineEnding } from '../core/lines';
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

/** A cell's text with the escape taken off each pipe, the text a spreadsheet reads; the cell
 *  writer puts it back. */
export function unescapeCellPipes(raw: string): string {
	return raw.replace(/\\\|/g, '|');
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

/** The cell's write rule; it reads nothing but the bytes. A cell has no line ending of its own,
 *  so the one a block write carries is dropped rather than turned into a space. */
export const tableCellWrite: WriteRule = {
	normalize: (raw) => normalizeCellRaw(trimTrailingLineEnding(raw)),
	mapOffset: (raw, offset) => {
		const text = trimTrailingLineEnding(raw);
		return escapedCellOffset(text, Math.min(offset, text.length));
	}
};
