/**
 * Stage 1 of the inline parser pipeline: balanced backtick code spans.
 * Emits text + inlineCode nodes for the scanned range.
 */

import type { InlineNode } from '../nodes';

/**
 * Returns resolved InlineNodes (text + inlineCode) for the range.
 * Used as input to the emphasis stage; code spans mark occupied ranges.
 */
export function scanBacktickSpans(raw: string, start: number, end: number): InlineNode[] {
	const nodes: InlineNode[] = [];
	let pos = start;
	let textStart = start;

	while (pos < end) {
		if (raw[pos] === '`') {
			const tickStart = pos;
			while (pos < end && raw[pos] === '`') pos++;
			const tickLen = pos - tickStart;

			// Search for matching closing backtick sequence
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
