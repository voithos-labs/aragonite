/**
 * G1.220: a fold the chain rebuild makes divides its list's bytes anew and writes none but blank
 * lines, so the list spells the same lines in the same order before and after. A read-back can't
 * hold that: a line written twice passes it wherever the doubled bytes read as the tree does.
 */

import type { InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { displayLines, isBlankText } from '../core/lines';

/** A list past this many bytes goes unchecked, so a fold in a huge document copies none of it. */
export const FOLD_LINES_LIMIT = 1 << 20;

/** What the check reads of a body: its blocks, and the blank lines the body holds round them. */
export interface FoldedList {
	readonly children: readonly { readonly leadingTrivia: string; readonly raw: string }[];
	readonly owner?: { readonly innerPrefix?: string; readonly innerSuffix?: string } | null;
	readonly suffix?: string;
}

/** The bytes `list` spells, or null past {@link FOLD_LINES_LIMIT}. */
export function foldedBytes(list: FoldedList): string | null {
	let bytes = list.owner?.innerPrefix ?? '';
	for (const block of list.children) {
		bytes += block.leadingTrivia + block.raw;
		if (bytes.length > FOLD_LINES_LIMIT) return null;
	}
	return bytes + (list.suffix ?? list.owner?.innerSuffix ?? '');
}

/** `before` and `after` are a list's {@link foldedBytes} either side of one fold. */
export function checkFoldKeepsLines(
	before: string | null,
	after: string | null
): InvariantViolation | null {
	if (before === null || after === null) return null;
	const was = contentLines(before);
	const now = contentLines(after);
	const at = was.findIndex((line, k) => line !== now[k]);
	if (at < 0 && was.length === now.length) return null;
	const first = at < 0 ? was.length : at;
	return {
		code: 'fold-keeps-lines',
		message: `a fold changed line ${first + 1} of the text its list spells`,
		detail: { was: was[first] ?? null, now: now[first] ?? null, lines: [was.length, now.length] }
	};
}

const contentLines = (bytes: string): string[] =>
	displayLines(bytes)
		.map((line) => line.text)
		.filter((text) => !isBlankText(text));
