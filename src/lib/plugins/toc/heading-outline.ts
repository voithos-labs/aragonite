/**
 * The heading outline as a pure function over the read-only document. The walk
 * recurses through containers, so a heading nested in a blockquote or list is still
 * collected at its own path and remains navigable.
 */

import {
	computeInlineContent,
	headingLevel,
	type DocumentView,
	type InlineNode,
	type NodeView
} from '$lib/plugin';

/** Deepest heading level a document can list; `[[toc]]` has no meaning past GFM's six. */
export const MAX_HEADING_DEPTH = 6;

/**
 * The instance's `{ plugin, options }` depth, else `fallback` (the factory argument's
 * bare-install default). Options arrive as `unknown` from the platform, so anything but a
 * whole number in 1..6 is not a depth and falls back rather than listing nothing.
 */
export function resolveMaxDepth(options: unknown, fallback: number): number {
	const declared = (options as { maxDepth?: unknown } | undefined)?.maxDepth;
	if (typeof declared !== 'number' || !Number.isInteger(declared)) return fallback;
	return declared >= 1 && declared <= MAX_HEADING_DEPTH ? declared : fallback;
}

export interface TocEntry {
	/** Stable and unique per position: the keyed-loop identity. */
	id: string;
	/** Doc-absolute block path of the heading, for `rects.scrollTo`. */
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

export function collectHeadings(document: DocumentView | undefined, maxDepth: number): TocEntry[] {
	const entries: TocEntry[] = [];

	const walk = (children: readonly NodeView[], basePath: number[]): void => {
		children.forEach((node, index) => {
			const path = [...basePath, index];
			const level = headingLevel(node);
			if (level !== null) {
				if (level <= maxDepth) {
					entries.push({
						id: path.join('.'),
						path,
						level,
						label: projectInlineText(computeInlineContent(node), node.raw).trim()
					});
				}
			} else if (node.children && node.children.length > 0) {
				walk(node.children, path);
			}
		});
	};

	walk(document?.children ?? [], []);
	return entries;
}
