/**
 * Where the reader is in reading mode, which has no caret: the editor's one tab stop (the block
 * whose own element last took focus, else the first on screen; every other block sits at -1), and
 * where focus and the last asked-for caret were, for leaving reading mode. The editing modes keep
 * every block at 0. `docs/design/editor.md` § Browser engines.
 */

import { tick, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkReadingTabStops } from '../../invariants/reading-tab-stops';
import { rawOffsetAt } from '../../browser/offsets';
import type { BlockElLookup } from '../../caret/block-el-lookup';
import { surfaceHolding } from '../../selection/path-lookup';
import { comparePaths } from '../../selection/path-math';
import { readNativeSelection } from '../../browser/selection-read';
import { widgetSourceRange } from '../../core/inline/widget-shell';
import { onRoot, removeAll } from './listeners';

export interface ReadingFocus {
	/** Keeps `el`'s tabindex and moves the stop to it when it takes focus itself (a widget inside
	 *  it doesn't count). Returns the release; one call per element. */
	hold(el: HTMLElement, getPath: () => readonly number[]): () => void;
	/** A still click: notes the point its caret marks, then drops the caret, so every engine starts
	 *  Tab from the focused block. A drag's or a double click's range stays. */
	noteClick(): void;
	/** A caret the editor asked for while reading, which it declines: leaving reading puts the
	 *  caret there while the block still holds focus. */
	notePoint(contentEl: HTMLElement, offset: number): void;
	/** The caret reading mode stands in for: after a focused widget, at a selection's focus or the
	 *  noted point in the focused block, else at its start. */
	focusCaret(): { path: number[]; offset: number } | null;
	/** {@link focusCaret}, read as the editor leaves reading mode, and forgotten. */
	takeExitCaret(): { path: number[]; offset: number } | null;
	/** Writes every held element's tabindex and hears focus moving inside `root`, which moves the
	 *  stop; a dev build checks that one block is a tab stop. */
	install(root: HTMLElement): () => void;
}

export interface ReadingFocusDeps {
	isReading(): boolean;
	/** Whether the mounted block at `path` shows in the editor's viewport. */
	isInView(path: readonly number[]): boolean;
	getBlockElByPath: BlockElLookup;
	isHostChrome(node: Node | null): boolean;
	/** Drops the browser's selection through the editor's one writer of it. */
	clearSelection(): void;
}

export function createReadingFocus(deps: ReadingFocusDeps): ReadingFocus {
	let stop = $state<string | null>(null);
	// Every mounted block's focus element, so a stop that windowed out falls back to one on screen.
	const held = new SvelteMap<HTMLElement, () => readonly number[]>();
	// What last took focus in the editor while reading: a jump's target, a Tab stop, a click.
	let focused: Element | null = null;
	// The point a click or a declined caret marked, kept while its block holds focus.
	let point: { contentEl: HTMLElement; offset: number } | null = null;

	// Read again as blocks mount and unmount, which a scroll far enough to need a fallback does.
	const effectiveStop = $derived.by((): string | null => {
		if (!deps.isReading()) return null;
		const paths = [...held.values()].map((getPath) => getPath());
		if (paths.some((path) => keyOf(path) === stop)) return stop;
		paths.sort(comparePaths);
		const fallback = paths.find((path) => deps.isInView(path)) ?? paths[0];
		return fallback ? keyOf(fallback) : null;
	});

	function focusCaret(): { path: number[]; offset: number } | null {
		const el = focused;
		const surface = el?.isConnected ? surfaceHolding(el, deps.getBlockElByPath) : null;
		if (!el || !surface) return null;
		const { path, contentEl } = surface;
		const widget = el.closest('[data-inline-widget]');
		const span = widget && widgetSourceRange(widget);
		if (span) return { path, offset: span.end };
		const focus = readNativeSelection()?.focus;
		if (focus && contentEl.contains(focus.node))
			return { path, offset: rawOffsetAt(contentEl, focus.node, focus.offset) };
		if (point?.contentEl === contentEl) return { path, offset: point.offset };
		return { path, offset: 0 };
	}

	return {
		hold(el, getPath) {
			// Focusable from the start, untracked so a mode switch doesn't re-run the caller's
			// attachment; the stop's effect settles which block keeps 0.
			el.tabIndex = untrack(deps.isReading) ? -1 : 0;
			held.set(el, getPath);
			return () => void held.delete(el);
		},
		noteClick() {
			if (!deps.isReading()) return;
			const sel = readNativeSelection();
			const surface = sel?.collapsed && surfaceHolding(sel.focus.node, deps.getBlockElByPath);
			if (!sel || !surface) return;
			point = {
				contentEl: surface.contentEl,
				offset: rawOffsetAt(surface.contentEl, sel.focus.node, sel.focus.offset)
			};
			deps.clearSelection();
			// A focus walk can still start where the press went down (WebKit's does); moving focus
			// off the block and back puts the start on the block itself.
			const active = document.activeElement;
			if (active instanceof HTMLElement && surface.contentEl.contains(active))
				refocusUnheard(active);
		},
		notePoint(contentEl, offset) {
			point = { contentEl, offset };
		},
		focusCaret,
		takeExitCaret() {
			const caret = focusCaret();
			focused = null;
			point = null;
			return caret;
		},
		install(root) {
			const tabIndexes = $effect.root(() => {
				$effect(() => {
					const reading = deps.isReading();
					for (const [el, getPath] of held) {
						const tabIndex = !reading || keyOf(getPath()) === effectiveStop ? 0 : -1;
						if (el.getAttribute('tabindex') !== `${tabIndex}`) el.tabIndex = tabIndex;
					}
					if (reading)
						void tick().then(() =>
							assertInvariant('reading-tab-stops', () => checkReadingTabStops(root))
						);
				});
			});
			return removeAll(
				tabIndexes,
				onRoot(root, 'focusin', (e: FocusEvent) => {
					const target = e.target;
					if (!(target instanceof Element)) return;
					// Every mode moves the stop, so entering reading mode finds it on the caret's block.
					const getPath = target instanceof HTMLElement ? held.get(target) : undefined;
					if (getPath) stop = keyOf(getPath());
					if (deps.isReading() && !deps.isHostChrome(target)) focused = target;
				})
			);
		}
	};
}

const FOCUS_EVENTS = ['blur', 'focusout', 'focus', 'focusin'] as const;

/** Blurs and refocuses `el` with its focus events stopped at `el`, so neither the editor's
 *  listeners nor the host's hear focus leave a block it never left. */
function refocusUnheard(el: HTMLElement): void {
	const stop = (e: Event) => e.stopImmediatePropagation();
	for (const type of FOCUS_EVENTS) el.addEventListener(type, stop, { capture: true });
	el.blur();
	el.focus({ preventScroll: true });
	for (const type of FOCUS_EVENTS) el.removeEventListener(type, stop, { capture: true });
}

function keyOf(path: readonly number[]): string {
	return path.join('.');
}
