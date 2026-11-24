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

// A title row is one line: Enter moves into the body, Shift+Enter is taken on its keydown to write
// nothing whatever input event the engine sends, Backspace and Delete take the merge path.
const CHROME_DEFAULT_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'chrome.descendToBody' },
	{ chord: 'Shift+Enter', command: 'block.hardBreak' },
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
		keymap: mergeChromeKeymap(opts.keymap)
		// No sample: the container's parser creates child 0, so a title-row leaf
		// never comes out of a document parse on its own.
	});
}
