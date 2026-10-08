/**
 * The one way a caret is put down after an edit or a restore: resolve the position to a leaf, mount
 * each level on the way, check the tree is still the one the caller aimed at, place, then bring
 * the block into view. One per editor, built in `Editor.svelte`; nothing else scrolls for a landing.
 */

import { assertInvariant } from '../assert';
import { CURSOR_END, CURSOR_START, type BlockComponent } from '../block-component';
import type { DocumentView } from '../core/node-views';
import type { CaretMemory } from '../caret/caret-memory';
import { docPathFrom } from '../caret/coordinate-spaces';
import type { ScrollOwner } from '../windowing/scroll-owner';
import type { BlockElLookup } from '../editor-keys';
import { isDevChecks } from '../env';
import { checkLandingFocusScrollsNothing } from '../invariants/landing-focus-scroll';
import { descendTo, type ChildList } from '../reactivity/child-list';
import { caretTargetFor } from './caret-target';
import { applySelectionToDom } from './native-bridge';
import { firstUsefulRect } from '../caret/visual-lines';
import { findBlockPathForElement, findCellPathForElement } from './path-lookup';
import type { CaretPosition, EditorSelection, SelectionPoint } from './primitives';
import {
	resolveSelectionPoint,
	restoreGapCaret,
	type SelectionRestoreOutcome
} from './selection-restore';
import { isGapSelection, type GapCaretSelection } from '../undo/types';
import type { SelectionState } from './selection-state.svelte';

/** How far a landing moves the viewport: not at all, or just far enough to show the caret when it
 *  isn't fully on screen. Holding a block in place is a navigation's alone (`navigate`). */
export type RevealPolicy = 'mount' | 'into-view';

export interface LandOptions {
	/** `'into-view'` when absent. */
	reveal?: RevealPolicy;
	/** The tree generation the caller aimed at; read at the call when absent. */
	stamp?: number;
}

type Reveal = RevealPolicy | 'held';

/** `'stale'`: an undo, redo or document swap happened while the landing waited, so it placed
 *  nothing. */
export type LandingOutcome = 'placed' | 'unresolvable' | 'stale';

export interface CaretLanding {
	/** Put the caret at `pos` as an arrival, through the block's own `focus`. */
	land(pos: CaretPosition, opts?: LandOptions): Promise<LandingOutcome>;
	/** Land as a navigation: open a collapsed body on the way, and hold the block where it landed
	 *  until the user scrolls, so a late image decode can't move it. */
	navigate(pos: CaretPosition): Promise<LandingOutcome>;
	/** Put a stored selection back at the bytes it names, or a gap caret at its boundary. */
	restore(
		selection: EditorSelection | GapCaretSelection,
		opts?: LandOptions
	): Promise<SelectionRestoreOutcome>;
	/** Mount `pos` and park a caret there without ending a live range. */
	park(pos: CaretPosition): Promise<boolean>;
	/** Mount the block at `path` and hand back its component, for a caller that dispatches to it. */
	mount(
		path: readonly number[],
		opts?: { openCollapsed?: boolean }
	): Promise<BlockComponent | null>;
	/** An arrow move put focus in the block at `path`: the page scrolls the least distance that
	 *  shows the caret's line, or the whole cell in a table. */
	followArrival(path: readonly number[]): void;
	/** Bumped by every undo, redo and document swap: a landing that waited across one is stale. */
	generation(): number;
	/** Called by the history restore and the document swap only, before the tree changes. */
	noteTreeSwap(): void;
}

export interface CaretLandingDeps {
	getDoc(): DocumentView;
	/** The editor root's child list, where every descent starts. */
	root: ChildList;
	selectionState: SelectionState;
	caretMemory: Pick<CaretMemory, 'forget' | 'noteExtreme'>;
	getBlockElByPath: BlockElLookup;
	/** The editor's own element, which holds focus while a block with no text is selected whole. */
	getEditorRoot(): HTMLElement | null;
	/** Null where nothing renders (a headless harness), so a landing only mounts. */
	scroll: Pick<ScrollOwner, 'shows' | 'showRect' | 'place' | 'port'> | null;
}

/** What a caret in `el` needs on screen: its line, when the selection's focus sits in `el` and
 *  measures, else `el`'s whole box (a divider, an empty line, a caret not placed yet). */
function caretBox(el: HTMLElement): DOMRectReadOnly {
	const selection = typeof window === 'undefined' ? null : window.getSelection();
	if (selection?.rangeCount && selection.focusNode && el.contains(selection.focusNode)) {
		const range = document.createRange();
		range.setStart(selection.focusNode, selection.focusOffset);
		const line = firstUsefulRect(range, false);
		if (line) return line;
	}
	return el.getBoundingClientRect();
}

export function createCaretLanding(deps: CaretLandingDeps): CaretLanding {
	let generation = 0;

	/** Runs the landing's focus and DOM placement, which scroll nothing (G1.45). */
	function placeWithoutScrolling<T>(place: () => T): T {
		if (!isDevChecks()) return place();
		const port = deps.scroll?.port();
		const before = port?.scrollTop() ?? null;
		const placed = place();
		assertInvariant('landing-focus-scrolls-nothing', () =>
			checkLandingFocusScrollsNothing(before, port?.scrollTop() ?? null)
		);
		return placed;
	}

	/** The only place a landing writes a scroll position. */
	async function bringIntoView(leafPath: readonly number[], reveal: Reveal): Promise<void> {
		const scroll = deps.scroll;
		if (reveal === 'mount' || !scroll) return;
		const el = deps.getBlockElByPath([...leafPath]);
		if (!el) return;
		if (reveal === 'held') {
			await scroll.place(leafPath, { block: 'nearest', hold: true }).scroll();
			return;
		}
		scroll.showRect(() => {
			const caret = caretBox(el);
			if (scroll.shows(caret)) return null;
			// A block that fits shows whole, as it always has; a taller one shows the caret's line.
			const box = el.getBoundingClientRect();
			return box.height <= (scroll.port()?.viewportHeight() ?? 0) ? box : caret;
		});
	}

	async function landAt(
		pos: CaretPosition,
		stamp: number,
		reveal: Reveal,
		open: { openCollapsed?: boolean }
	): Promise<LandingOutcome> {
		const target = caretTargetFor(deps.getDoc(), pos, open);
		if (!target) return 'unresolvable';
		const component = await descendTo(deps.root, target.leafPath, open);
		// The one check, after every await that mounts: the tree may have been swapped meanwhile.
		if (generation !== stamp) return 'stale';
		if (!component) return 'unresolvable';
		deps.caretMemory.forget();
		placeWithoutScrolling(() => component.focus(target.offset));
		// Placed at an edge rather than stepped there, so the caret means the outside of a
		// hidden closer (`docs/design/live-mode.md` § 4.2).
		if (target.offset === CURSOR_END || target.offset === CURSOR_START) {
			deps.caretMemory.noteExtreme();
		}
		await bringIntoView(target.leafPath, reveal);
		return 'placed';
	}

	return {
		land: (pos, opts = {}) => landAt(pos, opts.stamp ?? generation, opts.reveal ?? 'into-view', {}),
		navigate: (pos) => landAt(pos, generation, 'held', { openCollapsed: true }),

		async restore(selection, opts = {}) {
			const reveal = opts.reveal ?? 'into-view';
			if (isGapSelection(selection)) {
				return restoreGapCaret(selection.gapCaret, {
					getDoc: deps.getDoc,
					selectionState: deps.selectionState,
					caretMemory: deps.caretMemory,
					mount: (path) => descendTo(deps.root, path),
					reveal: (path) => bringIntoView(path, reveal)
				});
			}
			const stamp = opts.stamp ?? generation;
			const doc = deps.getDoc();
			const anchor = resolveSelectionPoint(doc, selection.anchor);
			const focus = resolveSelectionPoint(doc, selection.focus);
			if (!anchor || !focus) return 'unresolvable';
			// A stored caret places at its byte, not through the block's `focus`: the byte is where a
			// caret once sat, and a kind's own landing rule would move it.
			const caretAt = (point: SelectionPoint): SelectionPoint => {
				const cell = deps.selectionState.cellLandingFor(point);
				const target = caretTargetFor(doc, { path: docPathFrom(cell.path), offset: cell.offset });
				return target ? { path: [...target.leafPath], offset: target.offset } : cell;
			};
			const route = deps.selectionState.restoreRoute(anchor, focus);
			const holdsCaret = route === 'collapsed' || route === 'custom';
			const mountPath = holdsCaret ? caretAt(focus).path : focus.path;
			const mounted = await descendTo(deps.root, mountPath);
			if (generation !== stamp) return 'unplaced';
			deps.caretMemory.forget();
			const placed = placeWithoutScrolling(() =>
				applySelectionToDom(
					{ anchor, focus },
					{
						selectionState: deps.selectionState,
						getBlockElByPath: deps.getBlockElByPath,
						caretAt,
						getEditorRoot: deps.getEditorRoot
					}
				)
			);
			await bringIntoView(mountPath, reveal);
			return mounted && placed ? 'applied' : 'unplaced';
		},

		async park(pos) {
			const stamp = generation;
			const target = caretTargetFor(deps.getDoc(), pos);
			if (!target) return false;
			const component = await descendTo(deps.root, target.leafPath);
			if (generation !== stamp || !component?.parkCaret) return false;
			component.parkCaret(target.offset);
			return true;
		},

		mount: (path, opts) => descendTo(deps.root, path, opts),
		followArrival(path) {
			const el = deps.scroll && deps.getBlockElByPath([...path]);
			const active = el ? document.activeElement : null;
			if (!el?.contains(active)) return;
			// The cell that took the caret shows whole; in any other leaf only the caret's line, or a
			// paragraph taller than the viewport would jump the page by a screen.
			const cell = findCellPathForElement(active);
			const cellEl = cell && deps.getBlockElByPath(cell);
			const leaf = findBlockPathForElement(active);
			const leafEl = (leaf && deps.getBlockElByPath(leaf)) ?? el;
			deps.scroll?.showRect(() => (cellEl ? cellEl.getBoundingClientRect() : caretBox(leafEl)));
		},
		generation: () => generation,
		noteTreeSwap: () => {
			generation++;
		}
	};
}
