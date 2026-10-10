/**
 * The heading outline as a pure function over the read-only document. It recurses through
 * containers, so a heading nested in a blockquote or list is still collected at its own path
 * and stays navigable.
 */

import {
	computeInlineContent,
	headingLevel,
	trimWhitespace,
	walkBlocks,
	type DocumentView,
	type EditorContext,
	type InlineNode
} from '#lib/plugin.js';

/** Deepest heading level a document can list; `[[toc]]` has no meaning past GFM's six. */
export const MAX_HEADING_DEPTH = 6;

export interface TocEntry {
	/** Stable and unique per position: the keyed-loop identity. */
	id: string;
	/** Document-absolute block path of the heading, for `rects.scrollTo`. */
	path: number[];
	level: number;
	label: string;
}

/**
 * Plain-text projection: markers drop with their wrapper, value nodes show what they
 * render to, and anything unrecognized falls back to its source bytes.
 */
export function projectInlineText(nodes: readonly InlineNode[], raw: string): string {
	let text = '';
	for (const node of nodes) {
		if (node.children) text += projectInlineText(node.children, raw);
		else if (typeof node.text === 'string') text += node.text;
		else if (typeof node.decoded === 'string') text += node.decoded;
		else if (typeof node.url === 'string') text += node.url;
		else if (node.kind === 'rawHtml') continue;
		else text += raw.slice(node.start, node.end);
	}
	return text;
}

/** Labels read through `read`, the editor's inline parse, so syntax it left out stays text. */
export function collectHeadings(
	document: DocumentView | undefined,
	maxDepth: number,
	read: EditorContext['computeInlineContent'] = computeInlineContent
): TocEntry[] {
	const entries: TocEntry[] = [];
	if (!document) return entries;
	walkBlocks(document, (node, path) => {
		const level = headingLevel(node);
		if (level === null) return;
		if (level <= maxDepth) {
			entries.push({
				id: path.join('.'),
				path,
				level,
				label: trimWhitespace(projectInlineText(read(node), node.raw))
			});
		}
		return 'skip';
	});
	return entries;
}
