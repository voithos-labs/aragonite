import { endsInBlankLine, ownTrailingLineEnding } from '../../core/lines';
import type { CstNode, Document } from '../../core/nodes';
import type { ListResult } from './types';
import type { Host } from './types';
import { withoutLastEnding } from './endings';

export function lastLineOpen(document: Document): boolean {
	// The last non-empty part of the bytes, read from the end and never joined to the part above it,
	// so a long last block costs nothing.
	let last = document.suffix;
	for (let i = document.children.length - 1; last === '' && i >= 0; i--) {
		last = document.children[i].raw || document.children[i].leadingTrivia;
	}
	if (last === '') last = document.prefix;
	return last !== '' && ownTrailingLineEnding(last) === '';
}

export function keepLastLineOpen(document: Document, wasOpen: boolean, host: Host): ListResult {
	const last = document.children.length - 1;
	const node = document.children[last];
	const unchanged = { at: 0, removed: 0, blocks: [], keeps: [] };
	if (
		!wasOpen ||
		!node ||
		lastLineOpen(document) ||
		document.suffix !== '' ||
		lastLineBlank(node, host)
	)
		return unchanged;
	return { at: last, removed: 1, blocks: [withoutLastEnding(node, host)], keeps: [last] };
}

/** Whether the line `node` ends on is a blank line of a leaf (a container's own last line has a marker). */
function lastLineBlank(node: CstNode, host: Host): boolean {
	let leaf = node;
	while (leaf.children) {
		const inner = host.childWithLastLine(leaf);
		if (inner < 0) return false;
		leaf = leaf.children[inner];
	}
	return endsInBlankLine(leaf.raw);
}
