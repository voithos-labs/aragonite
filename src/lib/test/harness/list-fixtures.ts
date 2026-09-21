// Hand-built list shapes for the commit suites: minimal, not parser output, so a suite using them
// allows the stale-raw check where it fires. A list's own children carry no metadata: only an item
// the commit writes back carries the marker its id path reads.

import type { CstNode } from '$lib/core/nodes';

/** A list item as a mutate callback adds it: marker metadata included. */
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
