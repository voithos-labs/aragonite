/**
 * The document's heading outline, as a pure function over the read-only document —
 * the single source of truth the toc component renders and navigates by. The walk
 * recurses through containers (a heading inside a blockquote or list is collected
 * at its nested path), so a click can navigate to any heading in the tree.
 *
 * Labels are a plain-text projection of each heading's inline parse: formatting
 * markers dropped, links/images reduced to their text, and value nodes shown as
 * what they render to. The projection rule, in order:
 *
 *   children present   → concatenate the children (drops the wrapper's markers:
 *                        emphasis `*`, a link's `[](…)`, an image's `![](…)`)
 *   `text` present     → the text (plain text, inline code)
 *   `decoded` present  → the rendered glyph (an emoji shortcode → 😄, `&amp;` → &)
 *   `url` present      → the target (an autolink shows its url)
 *   raw-HTML tag       → nothing (markup with no textual content)
 *   otherwise          → the node's source bytes (an unknown atomic widget)
 */

import {
	computeInlineContent,
	headingLevel,
	type DocumentView,
	type InlineNode,
	type NodeView
} from '$lib/plugin';

export interface TocEntry {
	/** Stable, unique per position — the keyed-loop identity. */
	id: string;
	/** Doc-absolute block path of the heading, for `rects.scrollTo`. */
	path: number[];
	/** Heading level 1–6 (ATX depth or setext `=`/`-`). */
	level: number;
	/** Clean display text — the projected label. */
	label: string;
}

/** Plain-text projection of a heading's inline nodes (see the module header). */
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

/**
 * Every `heading`/`setextHeading` in the tree, in document order, whose level is
 * at most `maxDepth`. Containers are walked recursively; a plain leaf that is not
 * a heading contributes nothing.
 */
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
