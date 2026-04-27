/**
 * Inline pipeline stage 1: balanced backtick code spans. Emits text +
 * inlineCode nodes; later stages treat inlineCode ranges as occupied.
 *
 * CommonMark §6.1 example 311: a backslash-escaped opening backtick (`\``)
 * does not start a code span. Stage 1 runs before scanEscapes, so we check
 * for a preceding odd backslash count inline. Inside an opened span, per
 * CommonMark §6.5, backslashes are literal — closing-tick search ignores
 * preceding backslashes.
 */

import type { InlineNode } from '../nodes';

function isEscaped(raw: string, index: number): boolean {
	let backslashes = 0;
	let j = index - 1;
	while (j >= 0 && raw[j] === '\\') {
		backslashes++;
		j--;
	}
	return backslashes % 2 === 1;
}

export function scanBacktickSpans(raw: string, start: number, end: number): InlineNode[] {
	const nodes: InlineNode[] = [];
	let pos = start;
	let textStart = start;

	while (pos < end) {
		if (raw[pos] === '`') {
			if (isEscaped(raw, pos)) {
				pos++;
				continue;
			}
			const tickStart = pos;
			while (pos < end && raw[pos] === '`') pos++;
			const tickLen = pos - tickStart;

			let closeStart = -1;
			let searchPos = pos;
			while (searchPos < end) {
				if (raw[searchPos] === '`') {
					const cStart = searchPos;
					while (searchPos < end && raw[searchPos] === '`') searchPos++;
					if (searchPos - cStart === tickLen) {
						closeStart = cStart;
						break;
					}
				} else {
					searchPos++;
				}
			}

			if (closeStart !== -1) {
				if (textStart < tickStart) {
					nodes.push({
						kind: 'text',
						start: textStart,
						end: tickStart,
						text: raw.slice(textStart, tickStart)
					});
				}

				const contentStart = tickStart + tickLen;
				const contentEnd = closeStart;
				nodes.push({
					kind: 'inlineCode',
					start: tickStart,
					end: closeStart + tickLen,
					text: raw.slice(contentStart, contentEnd)
				});

				textStart = closeStart + tickLen;
				pos = textStart;
			}
		} else {
			pos++;
		}
	}

	if (textStart < end) {
		nodes.push({
			kind: 'text',
			start: textStart,
			end: end,
			text: raw.slice(textStart, end)
		});
	}

	return nodes;
}
