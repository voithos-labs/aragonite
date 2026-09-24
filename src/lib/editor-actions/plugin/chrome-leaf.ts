/**
 * Register a title-row leaf kind: editable text at a reserved child index of a plugin
 * container (a callout title, a details summary). The container declares the index via
 * `reservedChrome`; this registers the leaf. Only for such rows, never for a kind with its
 * own parser: the child is one line of plain text (`docs/design/plugin-contract.md`).
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
 * Create the reserved child-0 node for a title-row leaf. An empty title becomes a bare
 * newline, so the empty leaf still holds a line.
 */
export function chromeChild(kind: AnyBlockKind, text: string): CstNode {
	return makeBlockNode({ kind, leadingTrivia: '', raw: text ? `${text}\n` : '\n' });
}

export interface ChromeLeafOptions {
	/** What a screen reader and the block menu call the row; defaults to the kind in words. */
	label?: string;
	/** CSS class on the leaf's editable element, for styling the title row. */
	blockClass?: string;
	/** A binding replaces the default for its chord; the defaults fill the rest. */
	keymap?: KeyBinding[];
	/** Defaults to 'not-mergeable': body prose cannot merge into a title row. */
	mergeRole?: MergeRole;
}

// A title row serializes as one line, so Enter moves into the body instead of splitting;
// Backspace and Delete take the ordinary merge path.
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
		...(opts.label !== undefined ? { label: opts.label } : {}),
		gapEdges: 'none',
		mergeRole: opts.mergeRole ?? 'not-mergeable',
		editable: true,
		supportsInline: false,
		contextDependentKind: true,
		keymap: mergeChromeKeymap(opts.keymap),
		// No conformanceFixture: the container's parser creates child 0, so a title-row leaf
		// never comes out of a document parse on its own.
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
				reason: 'reserved child 0: no independent block identity to move'
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
	// Inline-only, so `surfaceForcesInline` holds if a paste ever reaches surface resolution:
	// a second line of defense behind the check that already flattens title-row pastes.
	registerPasteSurface({ kind, onInlinePaste: defaultInlineHook });
}
