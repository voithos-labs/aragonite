/**
 * The caret the editor draws itself: one bar per editor, inside the block it draws for, with the
 * browser's own caret hidden only on that editable. The native selection never moves, so typing,
 * IME and screen readers read the real one. A paint runs once per task after Svelte's flush, or at
 * the next frame for a move the browser made; it reads layout and writes only the bar and the mark
 * on the editable.
 */

import { tick, untrack } from 'svelte';
import { MediaQuery } from 'svelte/reactivity';
import type { SelectionState } from '../selection/selection-state.svelte';
import { firstUsefulRect, neighbourCaretRect } from './visual-lines';
import { isAtomicInlineWidget } from './widget-offset';
import {
	drawnCaretTarget,
	type DrawnCaretReads,
	type DrawnCaretRect,
	type DrawnCaretTarget
} from './drawn-caret-target';
import { markCaretPaint, markCaretRequest } from '../perf/instruments';
import { assertInvariant } from '../assert';
import { checkDrawnCaretAgrees, checkOneCaretShowing } from '../invariants/drawn-caret';

// ── Public API ──────────────────────────────────────────────────────────────

/** Who draws the caret: `auto` draws on a fine primary pointer and leaves a coarse one native. */
export type CaretMode = 'auto' | 'native' | 'drawn';

/** An editable the drawn caret may draw for, registered while it is mounted. */
export interface CaretSource {
	readonly el: HTMLElement;
	/** False while a composition or a shown inline source owns the caret: the native one shows. */
	drawable(): boolean;
}

export interface DrawnCaret {
	/** Paints once this task's flush has landed; a second call in the task adds nothing. */
	request(): void;
	/** Returns the unregister, for the editable's teardown. */
	register(source: CaretSource): () => void;
}

export interface DrawnCaretDeps {
	getRoot(): HTMLElement | null;
	caretMode(): CaretMode;
	isReading(): boolean;
	/** Read inside the drawn caret's own effect, so a range, a gap caret or a widget selected
	 *  whole repaints it. */
	selection: Pick<SelectionState, 'isCrossBlock' | 'wholeUnitPath' | 'gapCaret' | 'widget'>;
	/** The editor's one size observer; its callback only asks for a paint. */
	watchSize(el: Element, onResize: () => void): () => void;
}

/** The media the drawn caret answers to, each read live. */
export interface CaretMedia {
	finePointer: { readonly current: boolean };
	forcedColors: { readonly current: boolean };
}

/** Whether this editor draws its caret, read at each paint. Forced colors force the browser's
 *  caret visible whatever `caret-color` says, so a drawn one there would be a second caret. */
export function drawsCaret(mode: CaretMode, media: CaretMedia | null): boolean {
	if (media?.forcedColors.current) return false;
	if (mode !== 'auto') return mode === 'drawn';
	return media?.finePointer.current ?? false;
}

/** The page's media queries, or null where it has none to ask (no DOM, jsdom). */
export function caretMedia(): CaretMedia | null {
	if (typeof matchMedia !== 'function') return null;
	return {
		finePointer: new MediaQuery('(pointer: fine)'),
		forcedColors: new MediaQuery('(forced-colors: active)')
	};
}

/** Builds the drawn caret during the editor's init, where its effects are owned. */
export function createDrawnCaret(deps: DrawnCaretDeps): DrawnCaret {
	const sources = new Map<HTMLElement, CaretSource>();
	const media = caretMedia();
	let bar: HTMLElement | null = null;
	let drawnFor: HTMLElement | null = null;
	let painted: PaintedCaret | null = null;
	let blink: 'a' | 'b' = 'a';
	let requested = false;
	let frame = 0;
	let watched: { el: Element; stop: () => void } | null = null;

	function request(): void {
		if (requested) return;
		requested = true;
		markCaretRequest();
		void tick().then(paintRequested);
	}

	function paintRequested(): void {
		requested = false;
		paint();
		markCaretPaint();
	}

	// A move the browser made reaches the page in a later task, so its paint waits for the frame.
	function armFrame(): void {
		if (frame === 0) frame = requestAnimationFrame(paintAtFrame);
	}

	// A key the editor took writes its own caret, which asks for its paint.
	function onKeyDown(e: KeyboardEvent): void {
		if (!e.defaultPrevented) armFrame();
	}

	function paintAtFrame(): void {
		frame = 0;
		paint();
	}

	function paint(): void {
		const root = deps.getRoot();
		if (!root) return;
		const read = readCaret(root);
		const target = drawnCaretTarget(read.reads);
		draw(target, read);
		assertInvariant('one-caret-showing', () =>
			checkOneCaretShowing(root, DRAWN_ATTR, target.state === 'text' ? drawnFor : null)
		);
	}

	function readCaret(root: HTMLElement): CaretRead {
		const sel = window.getSelection();
		const active = document.activeElement;
		const source = active instanceof HTMLElement ? (sources.get(active) ?? null) : null;
		const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
		const owned = source && range && source.el.contains(range.startContainer) ? source : null;
		const draws = drawsCaret(deps.caretMode(), media);
		const drawable = owned?.drawable() ?? false;
		const measured = draws && owned && range?.collapsed && drawable ? measure(owned, range) : null;
		const { selection } = deps;
		return {
			source: owned,
			range,
			host: measured?.host ?? null,
			reads: {
				draws,
				reading: deps.isReading(),
				windowFocused: document.hasFocus(),
				focused: active !== null && root.contains(active),
				store: {
					crossBlock: selection.isCrossBlock,
					wholeBlock: selection.wholeUnitPath !== null,
					gapCaret: selection.gapCaret !== null,
					widget: selection.widget !== null
				},
				collapsed: !range || range.collapsed,
				source: owned ? { drawable } : null,
				besideWidget: measured?.besideWidget ?? false,
				atSoftWrap: measured?.atSoftWrap ?? false,
				caret: measured?.caret ?? null,
				host: measured?.hostBox ?? null,
				devicePixelRatio: window.devicePixelRatio || 1
			}
		};
	}

	function draw(target: DrawnCaretTarget, read: CaretRead): void {
		if (target.state !== 'text' || !read.source || !read.host || !read.range) {
			markDrawnFor(null);
			bar?.setAttribute('data-caret-state', target.state);
			painted = null;
			return;
		}
		const el = (bar ??= createBar());
		if (el.parentElement !== read.host) read.host.appendChild(el);
		const { rect } = target;
		const transform = `translate(${rect.x}px, ${rect.y}px)`;
		const height = `${rect.height}px`;
		if (el.style.transform !== transform || el.style.height !== height || !painted) {
			el.style.transform = transform;
			el.style.height = height;
			// Two identical keyframe names: switching restarts the blink, so a moved caret shows solid.
			blink = blink === 'a' ? 'b' : 'a';
			el.setAttribute('data-blink', blink);
		}
		el.setAttribute('data-caret-state', 'text');
		markDrawnFor(read.source.el);
		painted = {
			node: read.range.startContainer,
			offset: read.range.startOffset,
			rect,
			surface: read.source.el,
			surfaceSize: sizeOf(read.source.el)
		};
		watchSurface(read.source.el);
	}

	function markDrawnFor(el: HTMLElement | null): void {
		if (drawnFor !== el) drawnFor?.removeAttribute(DRAWN_ATTR);
		el?.setAttribute(DRAWN_ATTR, '');
		drawnFor = el;
	}

	// A reflow under a caret that did not move (a font load, a width change) repaints it.
	function watchSurface(el: HTMLElement): void {
		if (watched?.el === el) return;
		watched?.stop();
		watched = { el, stop: deps.watchSize(el, request) };
	}

	// At a selection change the painted bar must still sit on its caret, unless the caret moved.
	function onSelectionChange(): void {
		assertInvariant('drawn-caret-agrees', () => {
			const root = deps.getRoot();
			if (!root || !painted || requested || frame !== 0) return null;
			const read = readCaret(root);
			const now = drawnCaretTarget(read.reads);
			return checkDrawnCaretAgrees(painted, {
				node: read.range?.startContainer ?? null,
				offset: read.range?.startOffset ?? -1,
				rect: now.state === 'text' ? now.rect : null,
				surfaceSize: sizeOf(painted.surface)
			});
		});
		armFrame();
	}

	// An inner scroller (a wide table, a code block's overflow) moves the text under the bar; the
	// page's own scroll moves the block and the bar together.
	function onScroll(e: Event): void {
		if (drawnFor && e.target instanceof Node && bar?.parentElement?.contains(e.target)) request();
	}

	function install(root: HTMLElement): () => void {
		const listening = new AbortController();
		const on = { signal: listening.signal };
		root.addEventListener('focusin', request, on);
		root.addEventListener('focusout', request, on);
		root.addEventListener('compositionstart', request, on);
		root.addEventListener('compositionend', armFrame, on);
		root.addEventListener('keydown', onKeyDown, on);
		root.addEventListener('pointerdown', armFrame, on);
		root.addEventListener('pointerup', armFrame, on);
		root.addEventListener('scroll', onScroll, { capture: true, passive: true, ...on });
		window.addEventListener('blur', request, on);
		window.addEventListener('focus', armFrame, on);
		document.addEventListener('selectionchange', onSelectionChange, on);
		return () => {
			listening.abort();
			cancelAnimationFrame(frame);
			frame = 0;
			watched?.stop();
			watched = null;
			markDrawnFor(null);
			bar?.remove();
			bar = null;
			painted = null;
		};
	}

	$effect(() => {
		const root = deps.getRoot();
		if (!root) return;
		return untrack(() => install(root));
	});

	// What the paint reads from reactive state, so a change there repaints.
	$effect(() => {
		const { selection } = deps;
		void [selection.isCrossBlock, selection.wholeUnitPath, selection.gapCaret, selection.widget];
		void [deps.caretMode(), deps.isReading(), media?.finePointer.current];
		void media?.forcedColors.current;
		untrack(request);
	});

	return {
		request,
		register(source) {
			sources.set(source.el, source);
			request();
			return () => {
				if (sources.get(source.el) === source) sources.delete(source.el);
			};
		}
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/** On the editable the bar draws for, hiding the browser's caret there and only there. An
 *  attribute, not a class: Svelte rewrites an editable's whole class list when its kind changes. */
const DRAWN_ATTR = 'data-caret-drawn';

/** Drawn by the text block beside an inline widget; the bar steps aside while it shows. */
const SNAP_CARET_CLASS = 'md-snap-caret-active';

interface CaretRead {
	source: CaretSource | null;
	range: Range | null;
	host: HTMLElement | null;
	reads: DrawnCaretReads;
}

interface PaintedCaret {
	node: Node;
	offset: number;
	rect: DrawnCaretRect;
	surface: HTMLElement;
	surfaceSize: string;
}

function createBar(): HTMLElement {
	const el = document.createElement('div');
	el.className = 'md-drawn-caret';
	el.setAttribute('aria-hidden', 'true');
	return el;
}

function sizeOf(el: HTMLElement): string {
	return `${el.offsetWidth}x${el.offsetHeight}`;
}

/** The caret's box the way the sticky column reads it, and the host the bar is drawn in. */
function measure(source: CaretSource, range: Range) {
	const host = source.el.closest<HTMLElement>('[data-block-path]') ?? source.el.parentElement;
	if (!host) return null;
	const own = firstUsefulRect(range);
	const caret = own ?? neighbourCaretRect(range);
	const besideWidget =
		source.el.classList.contains(SNAP_CARET_CLASS) || (own === null && touchesWidget(range));
	const box = host.getBoundingClientRect();
	const scale = host.offsetWidth > 0 ? box.width / host.offsetWidth : 1;
	return {
		host,
		besideWidget,
		atSoftWrap: own !== null && atSoftWrap(range),
		caret: caret && { left: caret.left, top: caret.top, bottom: caret.bottom },
		hostBox: {
			left: box.left + (host.clientLeft - host.scrollLeft) * scale,
			top: box.top + (host.clientTop - host.scrollTop) * scale,
			scale
		}
	};
}

// A line wraps inside a run of spaces, and the range reads one line or the other there whatever
// line the browser draws on; the letters bounding the run sit on different lines exactly then.
function atSoftWrap(range: Range): boolean {
	const node = range.startContainer;
	if (node.nodeType !== Node.TEXT_NODE) return false;
	const text = node.textContent ?? '';
	let before = range.startOffset - 1;
	while (before >= 0 && WRAP_SPACE.includes(text[before])) before--;
	let after = range.startOffset;
	while (after < text.length && WRAP_SPACE.includes(text[after])) after++;
	if (before < 0 || after >= text.length) return false;
	const first = letterBox(node, before);
	const next = letterBox(node, after);
	return first !== null && next !== null && next.top >= first.bottom - 1;
}

const WRAP_SPACE = [' ', '\t'];

function letterBox(node: Node, at: number): DOMRect | null {
	const letter = document.createRange();
	letter.setStart(node, at);
	letter.setEnd(node, at + 1);
	return firstUsefulRect(letter);
}

function touchesWidget(range: Range): boolean {
	const container = range.startContainer;
	const kids = container.childNodes;
	const at = range.startOffset;
	return [kids[at], kids[at - 1]].some((node) => node !== undefined && isAtomicInlineWidget(node));
}
