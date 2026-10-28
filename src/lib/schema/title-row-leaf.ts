/**
 * The descriptor every title-row leaf kind registers: editable text at a container's reserved
 * child 0 (a callout title, a details summary, a `:::` container's opener line). Only for such
 * rows, never for a kind with its own parser (`docs/design/plugin-contract.md`).
 */

import { registerBlockKind, type ContentStart, type MergeRole } from './block-kind-descriptor';
import type { BlockView } from './block-view';
import { normalizeChord, type KeyBinding } from './keybindings';
import type { AnyBlockKind } from '../core/nodes';

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

/** A row whose bytes open with a marker (the `:::name` of an opener line) names its title part. */
export type RowLeafOptions = Omit<ChromeLeafOptions, 'blockClass'> & {
	contentStart?: ContentStart;
};

/** `view` draws the row, so the caller applies `blockClass` when it builds the view. */
export function registerTitleRowLeaf(
	kind: AnyBlockKind,
	view: BlockView,
	opts: RowLeafOptions = {}
): void {
	registerBlockKind(kind, {
		view,
		...(opts.contentStart ? { contentStart: opts.contentStart } : {}),
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
}
