import type { CstNode } from '../core/nodes';

// ── Blockquote ───────────────────────────────────────────────────────────────

/** Rebuild a blockquote's `raw`: `> ` on content lines, `>` on blank lines. */
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
 * Rebuild a list item's `raw`: first line gets the marker, continuation
 * lines get indentation. Blank lines stay unindented — GFM loose-list form.
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
			if (i === 0) return marker + line;
			if (line === '') return '';
			return indent + line;
		})
		.join('\n');
}

export function rebuildListRaw(node: CstNode): void {
	if (!node.children) return;
	node.raw = node.children.map((c) => c.leadingTrivia + c.raw).join('');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
 * Rebuild `raw` for every container along `path`, innermost first. The leaf
 * at the tail of `path` is NOT rebuilt — callers mutate its raw before calling.
 * Empty path: rebuild just `root`.
 */
export function rebuildAncestryRaw(root: CstNode, path: number[]): void {
	if (path.length === 0) {
		rebuildContainerRaw(root);
		return;
	}

	const containers: CstNode[] = [];
	let current = root;
	for (let i = 0; i < path.length - 1; i++) {
		current = current.children![path[i]];
		containers.push(current);
	}

	for (let i = containers.length - 1; i >= 0; i--) {
		rebuildContainerRaw(containers[i]);
	}
	rebuildContainerRaw(root);
}

/**
 * Dispatch to the correct per-kind rebuild helper. Throws when `node` isn't a
 * container — callers that walk ancestry chains and may encounter leaves should
 * use {@link rebuildContainerRawIfContainer} instead.
 *
 * Not dispatched via BlockKindDescriptor: plugging rebuildRaw into the registry
 * would create a module cycle between this file and block-kind-descriptor.ts.
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

/** Rebuild `raw` when `node` is a container kind; no-op on leaves. */
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
