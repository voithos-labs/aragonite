// Hand-built list shapes for the commit-ceremony suites: minimal, not parser output, so
// consuming suites allow the stale-raw oracle where it fires. A scope's own children stay
// metadata-free — only an item the ceremony publishes carries the marker its id path reads.

import type { CstNode } from '$lib/core/nodes';

/** A list item as a mutate callback pushes it: marker metadata included. */
export function makeListItem(raw: string): CstNode {
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw,
		metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
	} as CstNode;
}

/** A container scope over `childRaws`. */
export function makeListNode(
	childRaws: string[],
	opts: { leadingTrivia?: string; childIds?: string[] } = {}
): CstNode {
	return {
		kind: 'list',
		leadingTrivia: opts.leadingTrivia ?? '',
		raw: childRaws.join(''),
		children: childRaws.map((raw) => ({ kind: 'listItem', leadingTrivia: '', raw })),
		...(opts.childIds ? { childIds: [...opts.childIds] } : {})
	} as CstNode;
}
