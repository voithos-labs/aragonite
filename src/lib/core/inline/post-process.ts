/**
 * Inline parser post-processing: tree rewrites applied after the delimiter
 * pipeline has resolved all nesting. Splits text nodes on hard line break
 * sequences (backslash-before-\n or ≥2-spaces-before-\n) and merges adjacent
 * text siblings.
 */

import type { InlineNode } from '../nodes';

/**
 * Walk the inline node tree and split text nodes on hard line break patterns.
 * Hard breaks: backslash immediately before \n, or two or more spaces before \n.
 * Single space before \n is NOT a hard break.
 */
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

/**
 * Split a single text node on hard line break sequences.
 * Returns one or more nodes: text, hardLineBreak, text, ...
 */
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

		// Check for backslash break: char immediately before \n is '\'
		if (nlIdx > 0 && text[nlIdx - 1] === '\\') {
			// Text before the backslash
			const breakerStart = absNl - 1; // position of '\'
			if (segStart < breakerStart) {
				result.push({
					kind: 'text',
					start: segStart,
					end: breakerStart,
					text: raw.slice(segStart, breakerStart)
				});
			}
			// The hardLineBreak node covers the '\' and '\n'
			result.push({
				kind: 'hardLineBreak',
				start: breakerStart,
				end: absNl + 1
			});
			segStart = absNl + 1;
			i = nlIdx + 1;
			continue;
		}

		// Check for two-or-more spaces before \n.
		// Skip the '\r' in a CRLF sequence first so trailing spaces before
		// \r\n still count as a hard break.
		let spaceCount = 0;
		let j = nlIdx - 1;
		if (j >= 0 && text[j] === '\r') j--;
		while (j >= 0 && text[j] === ' ') {
			spaceCount++;
			j--;
		}

		if (spaceCount >= 2) {
			const spacesStart = start + j + 1; // absolute start of the trailing spaces
			// Text before the trailing spaces
			if (segStart < spacesStart) {
				result.push({
					kind: 'text',
					start: segStart,
					end: spacesStart,
					text: raw.slice(segStart, spacesStart)
				});
			}
			// The hardLineBreak node covers the spaces + \n
			result.push({
				kind: 'hardLineBreak',
				start: spacesStart,
				end: absNl + 1
			});
			segStart = absNl + 1;
			i = nlIdx + 1;
			continue;
		}

		// Not a hard break — advance past the \n
		i = nlIdx + 1;
	}

	// Remaining text
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
