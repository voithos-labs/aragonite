/**
 * Priority ladder for the built-in block openers — the single source the
 * registration sites in `core/parsers/built-in-openers.ts` consume, so the
 * published table and the registry can never drift: remove a key here and the
 * registration site fails to compile. Lower dispatches first. A plugin opener
 * whose matcher is a superset of a built-in's must price BELOW that built-in
 * (```mermaid claims a fence, so it sits under `fencedCode`); one that only
 * slots between built-ins prices into the gap (`<details>` before `htmlBlock`).
 * Equal priorities break by kind name, so a shared value is never load-bearing.
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
