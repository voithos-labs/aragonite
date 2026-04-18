/**
 * Raw text reconstruction for container blocks, plus the kind-dispatch
 * helpers that route ancestry walks to the right per-kind rebuilder.
 */

import type { CstNode } from '../core/nodes';

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

// ── Ancestry dispatch ────────────────────────────────────────────────────────

/**
 * Rebuild `raw` for every container along a path, from innermost to outermost.
 *
 * Given a root container node and a path (sequence of child-array indices
 * from root down to a target leaf), walks each container along the path and
 * calls the kind-appropriate rebuild helper. The leaf itself (the last node
 * pointed at by the path) is NOT rebuilt — the caller is expected to have
 * already mutated the leaf's raw before calling this.
 *
 * Used by cross-container merge (Editor.mergeWithPrevious) and by M1's
 * mergeListItemIntoPrevious (via the refactor in Task 4).
 */
export function rebuildAncestryRaw(root: CstNode, path: number[]): void {
	if (path.length === 0) {
		// Rebuild just the root container. Valid when the caller wants to
		// refresh `root.raw` without having mutated anything deeper — e.g.,
		// after a top-level child was replaced directly. If `root` is not a
		// container, `rebuildContainerRaw` throws.
		rebuildContainerRaw(root);
		return;
	}

	// Collect containers along the path, from outermost-inside-root to innermost.
	// path.length - 1 stops before the leaf index (we don't descend into the leaf).
	const containers: CstNode[] = [];
	let current = root;
	for (let i = 0; i < path.length - 1; i++) {
		current = current.children![path[i]];
		containers.push(current);
	}

	// Rebuild innermost first (end of the array), then walk outward.
	for (let i = containers.length - 1; i >= 0; i--) {
		rebuildContainerRaw(containers[i]);
	}
	// Finally rebuild root itself.
	rebuildContainerRaw(root);
}

/**
 * Dispatch to the correct per-kind rebuild helper. Throws when `node` isn't a
 * container — callers that walk ancestry chains and may encounter leaves should
 * use {@link rebuildContainerRawIfContainer} instead.
 *
 * NOTE: the switch here intentionally does not dispatch via the
 * `BlockKindDescriptor` registry. Plugging rebuildRaw into the descriptor
 * creates a module cycle (the descriptor file would import the rebuild
 * helpers from here, and this file would import the registry). The plugin-
 * system primitive for "register a custom rebuildRaw" from the roadmap is a
 * separable refactor; today's v0.5 block additions (table, image, etc.) are
 * all leaves — they don't need this hook.
 */
export function rebuildContainerRaw(node: CstNode): void {
	switch (node.kind) {
		case 'blockquote':
			rebuildBlockquoteRaw(node);
			return;
		case 'list':
			rebuildListRaw(node);
			return;
		case 'listItem':
			rebuildListItemRaw(node);
			return;
		default:
			throw new Error(
				`rebuildContainerRaw: unexpected kind "${node.kind}" — only container kinds (blockquote, list, listItem) are valid`
			);
	}
}

/**
 * Rebuild `raw` when `node` is a container kind; no-op on leaves. Used by
 * callers that walk an ancestry chain where some ancestors may be leaf blocks
 * (e.g., the path points at a paragraph inside a top-level list item).
 */
export function rebuildContainerRawIfContainer(node: CstNode): void {
	switch (node.kind) {
		case 'blockquote':
		case 'list':
		case 'listItem':
			rebuildContainerRaw(node);
			return;
		default:
			return;
	}
}
