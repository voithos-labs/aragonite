/**
 * Per-kind descriptor registry. Consolidates merge role, editability,
 * container-ness, and raw-rebuild logic that used to live in three separate
 * files (merge-rules.ts MERGE_ROLE + NON_EDITABLE_KINDS, container-raw.ts
 * dispatch switch, BlockHost.svelte isContainer literal). Adding a new
 * BlockKind means one `registerBlockKind` call instead of four edits.
 *
 * Built-in kinds register themselves at module load — callers of the public
 * getters can assume the registry is populated for every BlockKind in the
 * type union.
 */

import type { BlockKind } from '../core/nodes';

/**
 * A block's merge role classifies its behavior for Backspace-merge purposes.
 *
 *   prose           — leaf text block that can merge with or absorb other prose
 *   prose-absorber  — prose leaf that retains its kind when absorbing prose
 *                     (e.g. heading stays a heading)
 *   container       — block whose merge target is its deepest reachable prose leaf
 *   self-merge      — merges only with another block of the same role
 *   opaque          — not mergeable; Backspace either deletes (if non-editable)
 *                     or moves focus
 *
 * Declared here rather than in `merge-rules.ts` so the descriptor registry
 * can reference it without creating an import cycle.
 */
export type MergeRole = 'prose' | 'prose-absorber' | 'container' | 'self-merge' | 'opaque';

export interface BlockKindDescriptor {
	mergeRole: MergeRole;
	editable: boolean;
	isContainer: boolean;
}

const registry = new Map<BlockKind, BlockKindDescriptor>();

// ── Public API ──────────────────────────────────────────────────────────────

export function registerBlockKind(kind: BlockKind, descriptor: BlockKindDescriptor): void {
	registry.set(kind, descriptor);
}

export function getBlockKindDescriptor(kind: BlockKind): BlockKindDescriptor {
	const d = registry.get(kind);
	if (!d) {
		throw new Error(
			`getBlockKindDescriptor: no descriptor registered for kind "${kind}". ` +
				`Register at module load (see block-kind-descriptor.ts built-ins).`
		);
	}
	return d;
}

export function tryGetBlockKindDescriptor(kind: BlockKind): BlockKindDescriptor | undefined {
	return registry.get(kind);
}

// ── Built-in registrations ──────────────────────────────────────────────────

registerBlockKind('paragraph', { mergeRole: 'prose', editable: true, isContainer: false });
registerBlockKind('heading', { mergeRole: 'prose-absorber', editable: true, isContainer: false });
registerBlockKind('setextHeading', {
	mergeRole: 'prose-absorber',
	editable: true,
	isContainer: false
});
registerBlockKind('fencedCode', { mergeRole: 'opaque', editable: true, isContainer: false });
registerBlockKind('thematicBreak', { mergeRole: 'opaque', editable: false, isContainer: false });
registerBlockKind('indentedCode', { mergeRole: 'opaque', editable: true, isContainer: false });
registerBlockKind('htmlBlock', { mergeRole: 'opaque', editable: true, isContainer: false });
registerBlockKind('linkReferenceDefinition', {
	mergeRole: 'opaque',
	editable: true,
	isContainer: false
});
registerBlockKind('table', { mergeRole: 'opaque', editable: true, isContainer: false });
registerBlockKind('unrecognized', { mergeRole: 'self-merge', editable: true, isContainer: false });
registerBlockKind('blockquote', { mergeRole: 'container', editable: true, isContainer: true });
registerBlockKind('list', { mergeRole: 'container', editable: true, isContainer: true });
registerBlockKind('listItem', { mergeRole: 'container', editable: true, isContainer: true });
