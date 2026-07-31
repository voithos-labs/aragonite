/**
 * Register a container-chrome leaf kind: editable text at a reserved child slot of a
 * plugin container (a callout title, a details summary). The container declares the
 * slot via `reservedChrome`; this seam supplies the leaf. Chrome only, never a seam
 * for standalone recognizer-backed kinds — the reserved-chrome contract is a
 * single-line, plain-text child (`docs/design/plugin-contract.md`).
 */

import type { Component } from 'svelte';
import { registerBlockKind, type MergeRole } from '../../schema/block-kind-descriptor';
import {
	registerBlockComponent,
	defineBlockComponent
} from '../../schema/block-component-registry';
import { normalizeChord, type KeyBinding } from '../../schema/keybindings';
import { registerPasteSurface } from '../../tree-operations/paste-surfaces';
import { defaultInlineHook } from '../../tree-operations/paste/hooks';
import { makeBlockNode, type AnyBlockKind, type CstNode } from '../../core/nodes';
import type { BlockComponent, BlockComponentProps } from '../../block-component';

/**
 * Mint the reserved child-0 node for a chrome leaf. An empty title collapses to a
 * bare newline, so the empty leaf still holds a line.
 */
export function chromeChild(kind: AnyBlockKind, text: string): CstNode {
	return makeBlockNode({ kind, leadingTrivia: '', raw: text ? `${text}\n` : '\n' });
}

export interface ChromeLeafOptions {
	/** CSS class on the leaf's surface, for chrome styling. */
	blockClass?: string;
	/** A binding replaces the seam default for its chord; the defaults fill the rest. */
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

export function registerChromeLeaf<
	P extends Partial<BlockComponentProps> & Record<string, unknown>
>(kind: AnyBlockKind, component: Component<P, BlockComponent>, opts: ChromeLeafOptions = {}): void {
	registerBlockKind(kind, {
		mergeRole: opts.mergeRole ?? 'not-mergeable',
		editable: true,
		supportsInline: false,
		contextDependentKind: true,
		keymap: mergeChromeKeymap(opts.keymap),
		// No conformanceFixture: the container opener mints child-0, so a chrome leaf
		// never stands alone as a document scan's result.
		closure: {
			roundTrip: {
				mode: 'implemented',
				via: 'contextDependentKind — the container rebuildRaw emits the chrome bytes into its opener line'
			},
			focus: {
				mode: 'implemented',
				via: 'native caret; Enter descends to the body (chrome.descendToBody)'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable chrome — cleared-not-deleted by range ops; Backspace/Delete take the merge walk'
			},
			selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
			searchPaint: { mode: 'implemented', via: 'chrome raw scanned; matches painted as marks' },
			reorder: {
				mode: 'not-supported',
				reason: 'reserved child 0 — no independent block identity to move'
			},
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the chrome re-emits the container — a mid-chrome start reopens it around the collected body, a mid-chrome end yields a chrome-only container'
			},
			simOracle: {
				mode: 'implemented',
				via: 'reserved-chrome structural-ops e2e under the [invariant:] watcher'
			}
		}
	});
	registerBlockComponent(
		kind,
		defineBlockComponent(component, () => ({ blockClass: opts.blockClass }))
	);
	// Inline-only surface, so `surfaceForcesInline` holds if a paste ever reaches
	// surface resolution — defense behind the gate that already flattens chrome pastes.
	registerPasteSurface({ kind, onInlinePaste: defaultInlineHook });
}
