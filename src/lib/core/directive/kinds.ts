/**
 * Generic fallback kinds for the `:::name` directive primitive. An unregistered
 * directive name round-trips through these instead of resolving to a first-class
 * plugin kind, so `:::anything` stays lossless with no plugin installed.
 *
 * The container declares an `'opaque'` contract: the `:::name` fence lives in the
 * node's own `raw`, not in a child, so `strip(raw) !== serialize(children)` and
 * `rebuildDirectiveContainerRaw` is the single reconstruction path (mirrors the
 * callout/details precedents). Core-relative imports, not `$lib/plugin` — the
 * barrel pulls a Svelte component in and would cycle back through core.
 */

import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind, isBlockKindRegistered } from '../../schema/block-kind-descriptor';
import type { KeyBinding } from '../../schema/keybindings';
import { getPluginMetadata, type CstNode } from '../nodes';
import { displayLength, trimTrailingLineEnding } from '../lines';
import { concatChildren as serializeChildren } from '../serializer';
import { matchDirectiveOpener, serializeDirective } from './grammar';

export const DIRECTIVE_CONTAINER = 'directiveContainer';
export const DIRECTIVE_LEAF = 'directiveLeaf';
// Constant only this dispatch — the text-tier kind body lands with the inline widget.
export const DIRECTIVE_TEXT = 'directiveText';

/** Fence bytes a container node round-trips through `rebuildDirectiveContainerRaw`. */
export interface DirectiveContainerMetadata {
	name: string;
	colonCount: number;
	info: string;
	closerColonCount: number;
	closerNewline: boolean;
}

export function registerDirectiveKinds(): void {
	if (isBlockKindRegistered(DIRECTIVE_CONTAINER)) return; // idempotent for HMR / re-import

	registerBlockKind(declarePluginKind(DIRECTIVE_CONTAINER), {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'opaque',
			rebuildRaw: rebuildDirectiveContainerRaw,
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		}
	});

	registerBlockKind(declarePluginKind(DIRECTIVE_LEAF), {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		getContentRange: directiveLeafContentRange,
		keymap: DIRECTIVE_LEAF_KEYMAP
	});
}

// Enter opens a paragraph sibling (a leaf never holds an in-line break; the split
// reparses the empty tail to a paragraph); Backspace/Delete route through the
// not-mergeable merge walk, which moves focus rather than concatenating.
const DIRECTIVE_LEAF_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'block.split' },
	{ chord: 'Tab', command: 'block.insertTab' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' },
	{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Alt+ArrowDown', command: 'block.moveDown' }
];

// The `::name` fence is a dimmed marker prefix; the editable content is the info
// that follows it. Mirrors the heading marker-range mechanism for this non-prose
// leaf. A raw that no longer opens a fence (an edit broke `::name`) reparses to a
// paragraph before this is consulted, so the null branch is a defensive floor.
function directiveLeafContentRange(node: CstNode): { start: number; end: number } {
	const fence = matchDirectiveOpener(trimTrailingLineEnding(node.raw));
	const start = fence ? fence.colonCount + fence.name.length : 0;
	return { start, end: displayLength(node.raw) };
}

export function rebuildDirectiveContainerRaw(node: CstNode): void {
	const meta = getPluginMetadata<DirectiveContainerMetadata>(node);
	if (!meta) return;
	node.raw = serializeDirective({
		colonCount: meta.colonCount,
		name: meta.name,
		info: meta.info,
		innerPrefix: node.innerPrefix ?? '',
		body: serializeChildren(node.children ?? []),
		innerSuffix: node.innerSuffix ?? '',
		closerColonCount: meta.closerColonCount,
		closerNewline: meta.closerNewline
	});
}
