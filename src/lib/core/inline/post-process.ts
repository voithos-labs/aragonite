/**
 * Inline pipeline post-processing: split text on hard line breaks
 * (`\`+\n or ≥2 spaces + \n) and merge adjacent text siblings.
 */

import type { InlineNode } from '../nodes';

export function processHardLineBreaks(nodes: InlineNode[], raw: string): InlineNode[] {
	const result: InlineNode[] = [];
	for (const node of nodes) {
		if (node.kind === 'text') {
			const split = splitTextOnHardBreaks(node, raw);
			for (const n of split) result.push(n);
		} else if (node.children && node.children.length > 0) {
			result.push({ ...node, children: processHardLineBreaks(node.children, raw) });
		} else {
			result.push(node);
		}
	}
	return result;
}

function splitTextOnHardBreaks(node: InlineNode, raw: string): InlineNode[] {
	const { start, end } = node;
	const text = raw.slice(start, end);
	const result: InlineNode[] = [];
	let segStart = start;

	let i = 0;
	while (i < text.length) {
		const nlIdx = text.indexOf('\n', i);
		if (nlIdx === -1) break;

		const absNl = start + nlIdx;

		// Skip the '\r' of CRLF so the backslash check lands on the actual char before the break.
		const isCrLf = nlIdx > 0 && text[nlIdx - 1] === '\r';
		const backslashIdx = isCrLf ? nlIdx - 2 : nlIdx - 1;
		if (backslashIdx >= 0 && text[backslashIdx] === '\\') {
			const breakerStart = start + backslashIdx;
			if (segStart < breakerStart) {
				result.push({
					kind: 'text',
					start: segStart,
					end: breakerStart,
					text: raw.slice(segStart, breakerStart)
				});
			}
			result.push({
				kind: 'hardLineBreak',
				start: breakerStart,
				end: absNl + 1
			});
			segStart = absNl + 1;
			i = nlIdx + 1;
			continue;
		}

		// Skip the '\r' of CRLF so trailing spaces before \r\n still count.
		let spaceCount = 0;
		let j = nlIdx - 1;
		if (j >= 0 && text[j] === '\r') j--;
		while (j >= 0 && text[j] === ' ') {
			spaceCount++;
			j--;
		}

		if (spaceCount >= 2) {
			const spacesStart = start + j + 1;
			if (segStart < spacesStart) {
				result.push({
					kind: 'text',
					start: segStart,
					end: spacesStart,
					text: raw.slice(segStart, spacesStart)
				});
			}
			result.push({
				kind: 'hardLineBreak',
				start: spacesStart,
				end: absNl + 1
			});
			segStart = absNl + 1;
			i = nlIdx + 1;
			continue;
		}

		i = nlIdx + 1;
	}

	if (segStart < end) {
		result.push({
			kind: 'text',
			start: segStart,
			end: end,
			text: raw.slice(segStart, end)
		});
	}

	return result.length > 0 ? result : [node];
}

/** Merge adjacent text nodes into a single text node. */
export function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
	const result: InlineNode[] = [];
	for (const node of nodes) {
		const prev = result[result.length - 1];
		if (node.kind === 'text' && prev?.kind === 'text' && prev.end === node.start) {
			prev.end = node.end;
			prev.text = (prev.text ?? '') + (node.text ?? '');
		} else {
			result.push(node);
		}
	}
	return result;
}
