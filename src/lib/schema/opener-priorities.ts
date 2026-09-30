/**
 * Priority order for the built-in block openers, kept only here so the published table and the
 * registry cannot drift. Lower runs first, ties broken by kind name. A plugin opener that matches
 * everything a built-in matches and more needs a lower number than it (```mermaid below
 * `fencedCode`); one that belongs between two built-ins takes a number in the gap.
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
