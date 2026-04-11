/**
 * Raw text reconstruction for container blocks.
 * After editing inner children, the container's `raw` must be rebuilt
 * to keep serialization consistent.
 */

import type { CstNode } from './core/nodes';

// ── Blockquote ───────────────────────────────────────────────────────────────

/**
 * Rebuild a blockquote's `raw` from its inner children.
 * Prepends `> ` to each content line and `>` to blank lines.
 */
export function rebuildBlockquoteRaw(node: CstNode): void {
	if (!node.children) return;

	const innerContent =
		(node.innerPrefix ?? '') +
		node.children.map((c) => c.leadingTrivia + c.raw).join('') +
		(node.innerSuffix ?? '');

	node.raw = prefixLines(innerContent, '> ', '>');
}

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * Rebuild a list item's `raw` from its inner children.
 * First line gets the marker, continuation lines get indentation.
 * Blank lines between paragraphs are preserved without indentation
 * (this is how GFM represents "loose" list items).
 */
export function rebuildListItemRaw(node: CstNode): void {
	if (!node.children || !node.metadata) return;

	const marker = (node.metadata as { marker?: string }).marker ?? '- ';
	const indent = ' '.repeat(marker.length);

	const innerContent =
		(node.innerPrefix ?? '') +
		node.children.map((c) => c.leadingTrivia + c.raw).join('') +
		(node.innerSuffix ?? '');

	const lines = innerContent.split('\n');
	node.raw = lines
		.map((line, i) => {
			if (i === lines.length - 1 && line === '') return '';
			// First line: marker prefix; continuation lines: indented
			if (i === 0) return marker + line;
			// Blank lines are preserved without indentation (loose list items)
			if (line === '') return '';
			// Content continuation lines get indentation
			return indent + line;
		})
		.join('\n');
}

/**
 * Rebuild a list's `raw` by concatenating its list item children.
 */
export function rebuildListRaw(node: CstNode): void {
	if (!node.children) return;
	node.raw = node.children.map((c) => c.leadingTrivia + c.raw).join('');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Prepend a prefix to each line. Uses `contentPrefix` for non-blank lines
 * and `blankPrefix` for blank lines. The trailing empty string after the
 * final `\n` is preserved without a prefix.
 */
function prefixLines(text: string, contentPrefix: string, blankPrefix: string): string {
	const lines = text.split('\n');
	return lines
		.map((line, i) => {
			if (i === lines.length - 1 && line === '') return '';
			if (line === '') return blankPrefix;
			return contentPrefix + line;
		})
		.join('\n');
}
