/**
 * A block's inline content as a reader reads it, with no DOM: markers dropped, an entity as its
 * character, an image as its alt, an autolink as its address, a hard break as a line break, raw
 * HTML tags dropped, and a widget as its type says. `renderedText` (`visibility.ts`) is the
 * screen's answer, mode by mode; this one is the same in every mode and needs no render.
 */

import type { InlineNode } from '../nodes';

/** What a widget node reads as, by its type; undefined where the type says nothing. */
export type WidgetText = (node: InlineNode) => string | undefined;

export function readerText(nodes: readonly InlineNode[], raw: string, widget: WidgetText): string {
	let text = '';
	// Iterative, since nesting depth comes from the document.
	const stack = [...nodes].reverse();
	while (stack.length > 0) {
		const node = stack.pop()!;
		const own = ownText(node, raw, widget);
		if (own !== null) text += own;
		else for (let i = node.children!.length - 1; i >= 0; i--) stack.push(node.children![i]);
	}
	return text;
}

// A node's own text, or null for one whose text is its children's.
function ownText(node: InlineNode, raw: string, widget: WidgetText): string | null {
	switch (node.kind) {
		case 'hardLineBreak':
			return '\n';
		case 'rawHtml':
			return '';
		case 'escape':
			return raw.slice(node.start + 1, node.end);
		// As written, so `www.x.dev` keeps no added scheme and a mail address no `mailto:`.
		case 'autolink':
			return node.angle ? raw.slice(node.start + 1, node.end - 1) : raw.slice(node.start, node.end);
		case 'image':
			return node.children ? null : (node.alt ?? '');
		default:
			if (node.children) return null;
			if (node.text !== undefined) return node.text;
			return node.decoded ?? widget(node) ?? raw.slice(node.start, node.end);
	}
}
