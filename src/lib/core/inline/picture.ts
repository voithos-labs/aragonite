/**
 * Whether a paragraph is a picture on the page: it holds images and nothing else a user reads,
 * so it is an object picked up whole rather than prose. Read from the editor's inline parse, so
 * the answer is the one render draws: a reference image counts only once its definition exists.
 */

import type { InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { resolvedInlineContent, type InlineReading } from './inline-cache';

export function isImageOnlyParagraph(node: NodeView, reading: InlineReading): boolean {
	// Most paragraphs hold no image at all, and this runs for every block that renders.
	if (node.kind !== 'paragraph' || !node.raw.includes('![')) return false;
	const nodes = resolvedInlineContent(node, reading);
	return nodes.some(isPicturePart) && nodes.every((part) => isPicturePart(part) || isBlank(part));
}

// A linked image is still a picture: the link is where a click on it goes.
function isPicturePart(node: InlineNode): boolean {
	if (node.kind === 'image') return true;
	const children = node.children ?? [];
	return node.kind === 'link' && children.some(isPicturePart) && children.every(isPictureOrBlank);
}

function isPictureOrBlank(node: InlineNode): boolean {
	return isPicturePart(node) || isBlank(node);
}

function isBlank(node: InlineNode): boolean {
	if (node.kind === 'hardLineBreak') return true;
	return node.kind === 'text' && (node.text ?? '').trim() === '';
}
