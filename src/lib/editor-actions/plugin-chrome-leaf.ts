/**
 * Register a container-chrome leaf kind — editable text living at a reserved
 * child slot of a plugin container (a callout title, a details summary) —
 * through one call. The Fork-A spike measured that inside a container this
 * needs exactly one component (TextEditableBlock): the container seam already
 * threads every editor context, so the leaf mediates none. Chrome kinds are
 * `contextDependentKind` so a content edit keeps the kind, and `supportsInline`
 * stays off (inline-bearing chrome is an open pre-freeze question — the
 * off-window inline-cache issue). NOT the general Tier-2a editable leaf (a
 * recognizer-backed standalone kind) — that seam is separate and later.
 * Intended composition (target shape, not built yet): the container DECLARES
 * its chrome kind (a reserved-chrome capability on the descriptor or
 * createContainerBlock), and this seam supplies the leaf. Pre-freeze.
 */

import { registerBlockKind, type MergeRole } from '../schema/block-kind-descriptor';
import { registerBlockComponent, defineBlockComponent } from '../schema/block-component-registry';
import type { KeyBinding } from '../schema/keybindings';
import type { AnyBlockKind } from '../core/nodes';
import TextEditableBlock from '../components/blocks/text/TextEditableBlock.svelte';

export interface ChromeLeafOptions {
	/** CSS class on the leaf's surface, for chrome styling. */
	blockClass?: string;
	/** Chord→command overrides for this leaf. */
	keymap?: KeyBinding[];
	/** Defaults to 'not-mergeable' (chrome: body prose cannot merge into it). */
	mergeRole?: MergeRole;
}

export function registerChromeLeaf(kind: AnyBlockKind, opts: ChromeLeafOptions = {}): void {
	registerBlockKind(kind, {
		mergeRole: opts.mergeRole ?? 'not-mergeable',
		editable: true,
		isContainer: false,
		supportsInline: false,
		contextDependentKind: true,
		keymap: opts.keymap
	});
	registerBlockComponent(
		kind,
		defineBlockComponent(TextEditableBlock, () => ({ blockClass: opts.blockClass }))
	);
}
