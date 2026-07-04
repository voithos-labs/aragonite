/**
 * Register a container-chrome leaf kind — editable text living at a reserved
 * child slot of a plugin container (a callout title, a details summary) —
 * through one call. Inside a container this needs exactly one component
 * (TextEditableBlock): the container seam already threads every editor
 * context, so the leaf mediates none. Chrome kinds are `contextDependentKind`
 * so a content edit keeps the kind, and `supportsInline` stays off
 * (inline-bearing chrome is blocked on the off-window inline-cache issue).
 * Chrome only — not a seam for standalone recognizer-backed leaf kinds.
 * Composition: the container declares its chrome via `reservedChrome` on its
 * descriptor; this seam supplies the leaf.
 */

import { registerBlockKind, type MergeRole } from '../schema/block-kind-descriptor';
import { registerBlockComponent, defineBlockComponent } from '../schema/block-component-registry';
import { normalizeChord, type KeyBinding } from '../schema/keybindings';
import { registerPasteSurface } from '../tree-operations/paste-surfaces';
import { defaultInlineHook } from '../tree-operations/paste/hooks';
import type { AnyBlockKind } from '../core/nodes';
import TextEditableBlock from '../components/blocks/text/TextEditableBlock.svelte';

export interface ChromeLeafOptions {
	/** CSS class on the leaf's surface, for chrome styling. */
	blockClass?: string;
	/** Chord→command overrides: a binding replaces the seam default for its chord; defaults fill the rest. */
	keymap?: KeyBinding[];
	/** Defaults to 'not-mergeable' (chrome: body prose cannot merge into it). */
	mergeRole?: MergeRole;
}

// Chrome is single-line by serialization, so Enter descends into the body
// instead of splitting; Backspace/Delete take the ordinary merge walk.
const CHROME_DEFAULT_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'chrome.descendToBody' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' }
];

function mergeChromeKeymap(overrides: KeyBinding[] | undefined): KeyBinding[] {
	if (!overrides?.length) return [...CHROME_DEFAULT_KEYMAP];
	const overridden = new Set(overrides.map((b) => normalizeChord(b.chord)));
	return [
		...overrides,
		...CHROME_DEFAULT_KEYMAP.filter((b) => !overridden.has(normalizeChord(b.chord)))
	];
}

export function registerChromeLeaf(kind: AnyBlockKind, opts: ChromeLeafOptions = {}): void {
	registerBlockKind(kind, {
		mergeRole: opts.mergeRole ?? 'not-mergeable',
		editable: true,
		isContainer: false,
		supportsInline: false,
		contextDependentKind: true,
		keymap: mergeChromeKeymap(opts.keymap)
	});
	registerBlockComponent(
		kind,
		defineBlockComponent(TextEditableBlock, () => ({ blockClass: opts.blockClass }))
	);
	// Inline-only surface: no structural hooks, so `surfaceForcesInline` holds if a
	// paste ever reaches surface resolution — defense behind the dispatch gate that
	// already flattens chrome pastes.
	registerPasteSurface({ kind, onInlinePaste: defaultInlineHook });
}
