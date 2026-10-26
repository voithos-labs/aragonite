/**
 * The one way a caret is put down after an edit or a restore: resolve the position to a leaf, mount
 * each level on the way, check the tree is still the one the caller aimed at, place, then bring
 * the block into view. One per editor, built in `Editor.svelte`; nothing else scrolls for a landing.
 */

import { tick } from 'svelte';
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { CURSOR_START, type BlockComponent } from '../block-component';
import type { DocumentView } from '../core/node-views';
import type { CaretMemory } from '../caret/caret-memory';
import { docPathFrom } from '../core/coordinate-spaces';
import type { ScrollOwner } from '../windowing/scroll-owner';
import type { BlockElLookup } from '../caret/block-el-lookup';
import { checkLandingFocusScrollsNothing } from '../invariants/landing-focus-scroll';
import { checkReadingLandingLeavesNoCaret } from '../invariants/reading-landing-caret';
import { widgetTabStopEndingAt } from '../core/inline/inline-widgets';
import { componentAt, descendTo, type ChildList } from '../block-lists/child-list';
import { landsRestoredCaret } from './restored-caret';
import { caretTargetFor } from './caret-target';
import { applySelectionToDom } from './native-bridge';
import { readNativeSelection } from '../browser/selection-read';
import type { CaretWriter } from '../browser/caret-writer';
import { caretRectAt, caretRectAtRaw, lineHeightOf } from '../browser/lines';
import { findBlockPathForElement, findCellPathForElement } from './path-lookup';
import type { CaretPosition, EditorSelection, SelectionPoint } from './primitives';
import {
	resolveSelectionPoint,
	restoreGapCaret,
	type SelectionRestoreOutcome
} from './selection-restore';
import { isGapSelection, type GapCaretSelection } from '../undo/types';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { isWholeBlockUnit } from '../schema/whole-block-unit';
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
	/** Land as a navigation, opening a collapsed body and holding the block until the user scrolls
	 *  (a late image decode can't move it). Resolves the leaf it placed in, or null. */
	navigate(pos: CaretPosition): Promise<readonly number[] | null>;
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
	/** A gap caret was just placed: once it renders, the page scrolls the least distance that
	 *  shows it. */
	showGap(): Promise<void>;
	/** A key just moved the selection's moving end: its block mounts (a cell takes the caret) and
	 *  the page scrolls the least distance that shows the end. */
	showSelectionEnd(): Promise<void>;
	/** Bumped by every undo, redo, document swap and the unmount: a landing that waited across one
	 *  is stale. */
	generation(): number;
	/** Called by the history restore, the document swap and the unmount, before the tree goes. */
	noteTreeSwap(): void;
}

export interface CaretLandingDeps {
	getDoc(): DocumentView;
	/** The editor root's child list, where every descent starts. */
	root: ChildList;
	selectionState: SelectionState;
	/** The editor's caret writer, which every landing's caret and range goes through. */
	caretWriter: CaretWriter;
	caretMemory: Pick<CaretMemory, 'forget' | 'noteOutside'>;
	getBlockElByPath: BlockElLookup;
	/** The element a block shows whole by, chrome included. */
	getBlockBoxByPath: BlockElLookup;
	/** The editor's own element, which holds focus while a block with no text is selected whole. */
	getEditorRoot(): HTMLElement | null;
	/** Null where nothing renders (a headless harness), so a landing only mounts. */
	scroll: Pick<ScrollOwner, 'shows' | 'showRect' | 'place' | 'port'> | null;
	/** True in reading mode, where a landing moves focus and puts down no caret. */
	isReading(): boolean;
}

/** What a caret in `el` needs on screen: its line, when the selection's focus sits in `el` and
 *  measures, else `el`'s whole box (a divider, an empty line, a caret not placed yet). */
function caretBox(el: HTMLElement): DOMRectReadOnly {
	const focus = typeof window === 'undefined' ? null : readNativeSelection()?.focus;
	if (focus && el.contains(focus.node)) {
		const line = caretRectAt(el, focus.node, focus.offset);
		if (line) return line;
	}
	return el.getBoundingClientRect();
}

function firstLineBox(el: HTMLElement): DOMRectReadOnly {
	const box = el.getBoundingClientRect();
	return new DOMRect(box.left, box.top, box.width, Math.min(box.height, lineHeightOf(el)));
}

export function createCaretLanding(deps: CaretLandingDeps): CaretLanding {
	let generation = 0;
	/** True while the tree generation `stamp` names is still the one in place. */
	const at = (stamp: number) => () => generation === stamp;

	/** Runs the landing's focus and DOM placement, which scroll nothing (G1.45). */
	function placeWithoutScrolling<T>(place: () => T): T {
		if (!devChecksOn) return place();
		const port = deps.scroll?.port();
		const before = port?.scrollTop() ?? null;
		const placed = place();
		assertInvariant('landing-focus-scrolls-nothing', () =>
			checkLandingFocusScrollsNothing(before, port?.scrollTop() ?? null)
		);
		return placed;
	}

	/** The only place a landing writes a scroll position. `caret` measures what must show in the
	 *  block: the browser's caret, unless the caller says otherwise. */
	async function bringIntoView(
		leafPath: readonly number[],
		reveal: Reveal,
		caret: (el: HTMLElement) => DOMRectReadOnly = caretBox
	): Promise<void> {
		const scroll = deps.scroll;
		if (reveal === 'mount' || !scroll) return;
		const el = deps.getBlockElByPath([...leafPath]);
		if (!el) return;
		if (reveal === 'held') {
			await scroll.place(leafPath, { block: 'nearest', hold: true }).scroll();
			return;
		}
		scroll.showRect(() => {
			const line = caret(el);
			if (scroll.shows(line)) return null;
			// A block that fits shows whole, as it always has; a taller one shows the caret's line.
			const box = (deps.getBlockBoxByPath([...leafPath]) ?? el).getBoundingClientRect();
			return box.height <= (scroll.port()?.viewportHeight() ?? 0) ? box : line;
		});
	}

	async function showGap(): Promise<void> {
		await tick();
		// A live gap caret holds focus on its proxy, the box around the boundary.
		const proxy = document.activeElement;
		if (!deps.selectionState.gapCaret || !(proxy instanceof HTMLElement)) return;
		if (proxy.parentElement?.dataset.gapCaret === undefined) return;
		if (!deps.getEditorRoot()?.contains(proxy)) return;
		deps.scroll?.showRect(() => proxy.getBoundingClientRect());
	}

	async function park(pos: CaretPosition): Promise<boolean> {
		const stamp = generation;
		const target = caretTargetFor(deps.getDoc(), pos);
		if (!target) return false;
		const component = await descendTo(deps.root, target.leafPath, { current: at(stamp) });
		if (generation !== stamp || !component?.parkCaret) return false;
		component.parkCaret(target.offset);
		return true;
	}

	async function showSelectionEnd(): Promise<void> {
		const focus = deps.selectionState.focus;
		if (!focus) {
			const leaf = nativeFocusLeaf();
			if (leaf) await bringIntoView(leaf, 'into-view');
			return;
		}
		const end = deps.selectionState.cellLandingFor(focus);
		await descendTo(deps.root, end.path, { current: at(generation) });
		await bringIntoView(
			end.path,
			'into-view',
			(el) => caretRectAtRaw(el, end.offset) ?? el.getBoundingClientRect()
		);
		// The caret stays in the block the range began in, whose keys serve the range, until a far end
		// windows that block out. Then an end with text takes it, so a composition has somewhere to go.
		const node = blockNodeAt(deps.getDoc(), end.path);
		if (holdsFocus() || !node || isWholeBlockUnit(node)) return;
		// Raw 0 parks before any hidden marker; `CURSOR_START` clamps past them as a placement does.
		await park({ path: docPathFrom(end.path), offset: end.offset || CURSOR_START });
	}

	/** False once the element holding the caret has left the editor; true where nothing renders. */
	function holdsFocus(): boolean {
		const root = deps.getEditorRoot();
		return !root || root.contains(document.activeElement);
	}

	/** The leaf holding the browser's selection focus, a table cell's own path in a cell. */
	function nativeFocusLeaf(): number[] | null {
		const node = readNativeSelection()?.focus.node;
		const el = node instanceof Element ? node : (node?.parentElement ?? null);
		if (!el || !deps.getEditorRoot()?.contains(el)) return null;
		return findCellPathForElement(el) ?? findBlockPathForElement(el);
	}

	function showArrival(path: readonly number[]): void {
		const el = deps.scroll && deps.getBlockElByPath([...path]);
		const active = el ? document.activeElement : null;
		if (!el?.contains(active)) return;
		// A cell shows whole; any other leaf only the caret's line (its first, in reading mode), so a
		// paragraph taller than the viewport doesn't jump the page by a screen.
		const cell = findCellPathForElement(active);
		const cellEl = cell && deps.getBlockElByPath(cell);
		const leaf = findBlockPathForElement(active);
		const leafEl = (leaf && deps.getBlockElByPath(leaf)) ?? el;
		deps.scroll?.showRect(() => {
			if (cellEl) return cellEl.getBoundingClientRect();
			return deps.isReading() ? firstLineBox(leafEl) : caretBox(leafEl);
		});
	}

	/** Reading mode has no caret: the block's own `focus` picks the element, focus moves on to a
	 *  widget ending at the landing point, and the caret goes, so every engine starts Tab there. */
	function focusWithoutCaret(
		component: BlockComponent,
		leafPath: readonly number[],
		offset: number
	) {
		deps.selectionState.batch(() => {
			component.focus(offset);
			const el = deps.getBlockElByPath([...leafPath]);
			(el && widgetTabStopEndingAt(el, offset))?.focus({ preventScroll: true });
			deps.caretWriter.clear();
		});
	}

	async function landAt(
		pos: CaretPosition,
		stamp: number,
		reveal: Reveal,
		open: { openCollapsed?: boolean }
	): Promise<{ outcome: LandingOutcome; leafPath?: readonly number[] }> {
		const target = caretTargetFor(deps.getDoc(), pos, open);
		if (!target) return { outcome: 'unresolvable' };
		const component = await descendTo(deps.root, target.leafPath, { ...open, current: at(stamp) });
		// A descent cut short by a swap reports 'stale', not 'unresolvable'.
		if (generation !== stamp) return { outcome: 'stale' };
		if (!component) return { outcome: 'unresolvable' };
		deps.caretMemory.forget();
		const reading = deps.isReading();
		placeWithoutScrolling(() =>
			reading
				? focusWithoutCaret(component, target.leafPath, target.offset)
				: component.focus(target.offset)
		);
		// A split's second half starts plain, whatever format the text after the cut carries.
		if (pos.fresh) deps.caretMemory.noteOutside();
		await bringIntoView(target.leafPath, reveal);
		if (reading) {
			assertInvariant('reading-landing-leaves-no-caret', () =>
				checkReadingLandingLeavesNoCaret(
					deps.getBlockElByPath([...target.leafPath]),
					readNativeSelection()?.focus.node ?? null
				)
			);
		}
		return { outcome: 'placed', leafPath: target.leafPath };
	}

	return {
		land: async (pos, opts = {}) =>
			(await landAt(pos, opts.stamp ?? generation, opts.reveal ?? 'into-view', {})).outcome,
		navigate: async (pos) =>
			(await landAt(pos, generation, 'held', { openCollapsed: true })).leafPath ?? null,

		async restore(selection, opts = {}) {
			const reveal = opts.reveal ?? 'into-view';
			const stamp = opts.stamp ?? generation;
			if (isGapSelection(selection)) {
				return restoreGapCaret(selection.gapCaret, {
					getDoc: deps.getDoc,
					selectionState: deps.selectionState,
					caretWriter: deps.caretWriter,
					caretMemory: deps.caretMemory,
					mount: (path) => descendTo(deps.root, path, { current: at(stamp) }),
					show: reveal === 'mount' ? async () => {} : showGap,
					current: at(stamp)
				});
			}
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
			const mounted = await descendTo(deps.root, mountPath, { current: at(stamp) });
			if (generation !== stamp) return 'unplaced';
			deps.caretMemory.forget();
			// Reading mode has no caret, so a stored one lands as focus on its block, as a jump does.
			const readingCaret = deps.isReading() && route === 'collapsed' ? caretAt(focus) : null;
			const readingTarget = readingCaret && componentAt(deps.root, readingCaret.path);
			if (readingCaret && readingTarget) {
				placeWithoutScrolling(() =>
					focusWithoutCaret(readingTarget, readingCaret.path, readingCaret.offset)
				);
				await bringIntoView(mountPath, reveal);
				return mounted ? 'applied' : 'unplaced';
			}
			const placed = placeWithoutScrolling(() =>
				applySelectionToDom(
					{ anchor, focus },
					{
						selectionState: deps.selectionState,
						getBlockElByPath: deps.getBlockElByPath,
						caretAt,
						getEditorRoot: deps.getEditorRoot,
						caretWriter: deps.caretWriter,
						landCaret: (point) => {
							const component = componentAt(deps.root, point.path);
							if (!component || !landsRestoredCaret(component)) return false;
							component.landRestoredCaret(point.offset);
							return true;
						}
					}
				)
			);
			await bringIntoView(mountPath, reveal);
			return mounted && placed ? 'applied' : 'unplaced';
		},

		park,

		mount: (path, opts) => descendTo(deps.root, path, { ...opts, current: at(generation) }),
		followArrival(path) {
			// A block showing its source on arrival focuses a tick after the move hands it the caret.
			void tick().then(() => showArrival(path));
		},
		showGap,
		showSelectionEnd,
		generation: () => generation,
		noteTreeSwap: () => {
			generation++;
		}
	};
}
