/**
 * The one way a caret is put down after an edit or a restore: resolve the position to a leaf, mount
 * each level on the way, check the tree is still the one the caller aimed at, place, then bring
 * the block into view. One per editor, built in `Editor.svelte`; nothing else scrolls for a landing.
 */

import { CURSOR_END, CURSOR_START, type BlockComponent } from '../block-component';
import type { DocumentView } from '../core/node-views';
import type { CaretMemory } from '../cursor/caret-memory';
import { docPathFrom } from '../cursor/coordinate-spaces';
import type { ScrollSettle } from '../editor-rects';
import type { BlockElLookup } from '../editor-keys';
import { descendTo, type ChildList } from '../reactivity/child-list';
import { caretTargetFor } from './caret-target';
import { applySelectionToDom } from './native-bridge';
import type { CaretPosition, EditorSelection, SelectionPoint } from './primitives';
import { resolveSelectionPoint, type SelectionRestoreOutcome } from './selection-restore';
import type { SelectionState } from './selection-state.svelte';

/** How far a landing moves the viewport: not at all, into view when the block is off screen, or
 *  into view and held there against later layout shifts. */
export type RevealPolicy = 'mount' | 'into-view' | 'into-view-held';

export interface LandOptions {
	/** `'into-view'` when absent. */
	reveal?: RevealPolicy;
	/** Open a collapsed body on the way instead of landing on its title row; navigation only. */
	openCollapsed?: boolean;
	/** The tree generation the caller aimed at; read at the call when absent. */
	stamp?: number;
}

/** `'stale'`: an undo, redo or document swap happened while the landing waited, so it placed
 *  nothing. */
export type LandingOutcome = 'placed' | 'unresolvable' | 'stale';

export interface CaretLanding {
	/** Put the caret at `pos` as an arrival, through the block's own `focus`. */
	land(pos: CaretPosition, opts?: LandOptions): Promise<LandingOutcome>;
	/** Put a stored selection back at the bytes it names. */
	restore(selection: EditorSelection, opts?: LandOptions): Promise<SelectionRestoreOutcome>;
	/** Mount `pos` and park a caret there without ending a live range. */
	park(pos: CaretPosition): Promise<boolean>;
	/** Mount the block at `path` and hand back its component, for a caller that dispatches to it. */
	mount(
		path: readonly number[],
		opts?: { openCollapsed?: boolean }
	): Promise<BlockComponent | null>;
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
	scroll: ScrollSettle | null;
}

export function createCaretLanding(deps: CaretLandingDeps): CaretLanding {
	let generation = 0;

	/** The only place a landing writes a scroll position. */
	async function bringIntoView(leafPath: readonly number[], reveal: RevealPolicy): Promise<void> {
		const scroll = deps.scroll;
		if (reveal === 'mount' || !scroll || !deps.getBlockElByPath([...leafPath])) return;
		if (reveal === 'into-view' && scroll.isInView(leafPath)) return;
		await scroll.place(leafPath, { block: 'nearest', hold: reveal === 'into-view-held' }).scroll();
	}

	return {
		async land(pos, opts = {}) {
			const stamp = opts.stamp ?? generation;
			const open = { openCollapsed: opts.openCollapsed };
			const target = caretTargetFor(deps.getDoc(), pos, open);
			if (!target) return 'unresolvable';
			const component = await descendTo(deps.root, target.leafPath, open);
			// The one check, after every await that mounts: the tree may have been swapped meanwhile.
			if (generation !== stamp) return 'stale';
			if (!component) return 'unresolvable';
			deps.caretMemory.forget();
			component.focus(target.offset);
			// Placed at an edge rather than stepped there, so the caret means the outside of a
			// hidden closer (`docs/design/live-mode.md` § 4.2).
			if (target.offset === CURSOR_END || target.offset === CURSOR_START) {
				deps.caretMemory.noteExtreme();
			}
			await bringIntoView(target.leafPath, opts.reveal ?? 'into-view');
			return 'placed';
		},

		async restore(selection, opts = {}) {
			const stamp = opts.stamp ?? generation;
			const doc = deps.getDoc();
			const anchor = resolveSelectionPoint(doc, selection.anchor);
			const focus = resolveSelectionPoint(doc, selection.focus);
			if (!anchor || !focus) return 'unresolvable';
			const open = { openCollapsed: opts.openCollapsed };
			// A stored caret places at its byte, not through the block's `focus`: the byte is where a
			// caret once sat, and a kind's own landing rule would move it.
			const caretAt = (point: SelectionPoint): SelectionPoint => {
				const cell = deps.selectionState.cellLandingFor(point);
				const target = caretTargetFor(
					doc,
					{ path: docPathFrom(cell.path), offset: cell.offset },
					open
				);
				return target ? { path: [...target.leafPath], offset: target.offset } : cell;
			};
			const route = deps.selectionState.restoreRoute(anchor, focus);
			const holdsCaret = route === 'collapsed' || route === 'custom';
			const mountPath = holdsCaret ? caretAt(focus).path : focus.path;
			const mounted = await descendTo(deps.root, mountPath, open);
			if (generation !== stamp) return 'unplaced';
			deps.caretMemory.forget();
			const placed = applySelectionToDom(
				{ anchor, focus },
				{
					selectionState: deps.selectionState,
					getBlockElByPath: deps.getBlockElByPath,
					caretAt,
					getEditorRoot: deps.getEditorRoot
				}
			);
			await bringIntoView(mountPath, opts.reveal ?? 'into-view');
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
		generation: () => generation,
		noteTreeSwap: () => {
			generation++;
		}
	};
}
