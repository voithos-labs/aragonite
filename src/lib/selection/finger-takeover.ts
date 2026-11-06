/**
 * Turns a range the browser made under a finger into the editor's own: the editor paints it and
 * draws its handles, and the native selection collapses to a caret, so no phone draws its own
 * handles or menu on it. See `docs/design/selection.md` § Cross-block selection.
 */

import type { SelectionState } from './selection-state.svelte';
import type { FingerPress } from './pointer-gesture';
import type { CaretWriter } from '../browser/caret-writer';
import type { BlockElLookup } from '../caret/block-el-lookup';
import { readNativeSelection } from '../browser/selection-read';
import { applyCollapsedCaret, applySingleBlockRange, readDomPoint } from './native-bridge';
import { pathsEqual } from './path-math';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkFingerRangeLeavesCaret } from '../invariants/finger-range-leaves-caret';

export interface TakeoverDeps {
	editorRoot: HTMLElement;
	selection: SelectionState;
	caretWriter: CaretWriter;
	getBlockElByPath: BlockElLookup;
	lifetimeSignal: AbortSignal | null;
}

/** Takes the native range inside one block (a table cell counts) over, and until the next press
 *  every range the browser writes in that block (Safari's word written back, Android's held drag). */
export function takeOverBrowserRange(deps: TakeoverDeps, press: FingerPress): void {
	const path = takeOnce(deps, press, null);
	if (!path || deps.lifetimeSignal?.aborted) return;
	const done = new AbortController();
	const opts = { capture: true, signal: done.signal };
	deps.lifetimeSignal?.addEventListener('abort', () => done.abort(), { signal: done.signal });
	document.addEventListener('pointerdown', () => done.abort(), opts);
	document.addEventListener(
		'selectionchange',
		() => {
			// Anything that ended the range (a key, a command) ends the adopting too.
			if (!deps.selection.isCustomRendered) return done.abort();
			if (takeOnce(deps, press, path)) return;
			const live = readNativeSelection();
			assertInvariant('finger-range-leaves-caret', () =>
				checkFingerRangeLeavesCaret(!live || live.collapsed)
			);
		},
		opts
	);
}

/** Gives a finger's range inside one block back to the browser, direction kept, for a key the
 *  browser steps a character or a line at a time; false for any other range the editor holds. */
export function returnBlockRangeToBrowser(
	selection: SelectionState,
	writer: CaretWriter,
	blockEl: HTMLElement | null
): boolean {
	const { anchor, focus } = selection;
	if (!anchor || !focus || !blockEl || !selection.rangeInOneBlock) return false;
	// The native range first, so a subscriber the collapse notifies reads it; the adopting
	// `selectionchange` above fires as a later task and sees the range already ended.
	applySingleBlockRange(writer, blockEl, anchor.offset, focus.offset);
	selection.collapse();
	return true;
}

// The block the range was taken in, or null when the native selection held nothing to take: no
// range, or a range across blocks or in another block than `inBlock`.
function takeOnce(
	deps: TakeoverDeps,
	press: FingerPress,
	inBlock: number[] | null
): number[] | null {
	const live = readNativeSelection();
	if (!live || live.collapsed) return null;
	const anchor = readDomPoint(deps.editorRoot, live.anchor.node, live.anchor.offset);
	const focus = readDomPoint(deps.editorRoot, live.focus.node, live.focus.offset);
	if (!anchor || !focus || !pathsEqual(anchor.path, focus.path)) return null;
	if (inBlock && !pathsEqual(anchor.path, inBlock)) return null;
	deps.selection.ownBlockRange(anchor, focus, press);
	if (!deps.selection.isCustomRendered) {
		deps.selection.collapse();
		return null;
	}
	const blockEl = deps.getBlockElByPath(focus.path);
	if (blockEl) applyCollapsedCaret(deps.caretWriter, blockEl, focus);
	return anchor.path;
}
