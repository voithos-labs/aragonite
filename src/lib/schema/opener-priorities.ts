/**
 * Priority ladder for the built-in block openers, single-sourced here so the published table and
 * the registry cannot drift. Lower dispatches first, ties broken by kind name. A plugin opener
 * whose matcher is a superset of a built-in's must price BELOW it (```mermaid under
 * `fencedCode`); one that only slots between built-ins prices into the gap.
 */

import type { BlockKind } from '../core/nodes';

export const OPENER_PRIORITIES = {
	fencedCode: 10,
	heading: 20,
	thematicBreak: 30,
	blockquote: 40,
	list: 50,
	indentedCode: 60,
	htmlBlock: 70,
	linkReferenceDefinition: 80
} as const satisfies Partial<Record<BlockKind, number>>;
