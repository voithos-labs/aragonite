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
import { getPluginMetadata, type CstNode } from '../nodes';
import { concatChildren as serializeChildren } from '../serializer';
import { serializeDirective } from './grammar';

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
		supportsInline: false
	});
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
