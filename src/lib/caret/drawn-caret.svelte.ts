/**
 * The caret the editor draws itself: one bar per editor, inside the block it draws for, with the
 * browser's own caret hidden only on that editable. It also draws where the browser can't: beside
 * an inline widget and across a gap between blocks. The native selection never moves, so typing,
 * IME and screen readers read the real one. A paint runs once per task after Svelte's flush, or at
 * the next frame for a move the browser made; it reads layout and writes only the bar and the mark.
 */

import { tick, untrack } from 'svelte';
import { MediaQuery } from 'svelte/reactivity';
import type { SelectionState } from '../selection/selection-state.svelte';
import { caretHost, chipStopBox, codeChipEdge, hostBox, measureCaret } from './drawn-caret-measure';
import {
	drawnCaretTarget,
	hidesBrowserCaret,
	type DrawnCaretReads,
	type DrawnCaretRect,
	type DrawnCaretTarget,
	type WidgetEdgeBox
} from './drawn-caret-target';
import {
	countCaretPaint,
	markCaretPaint,
	markCaretRequest,
	recordCaretFrameMove
} from '../perf/instruments';
import type { CaretLook } from './caret-look';
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
	/** How an editable with inline widgets draws the caret beside one; absent where it has none. */
	readonly widgetEdge?: WidgetEdgeSource;
	/** Set by the gap caret's proxy: the element the bar lies across, between two blocks. */
	readonly gapHost?: HTMLElement;
	/** The look of a text caret at `range`, a collapsed range inside `el`; absent draws the plain bar. */
	look?(range: Range): CaretLook;
}

/** The widget edges an editable can draw at, keyed by the owner object it made at construction. */
export interface WidgetEdgeSource {
	readonly owner: object;
	/** The bar beside the widget at `offset`, or null when no widget sits there. */
	box(offset: number): WidgetEdgeBox | null;
	/** A pointer-down left the browser's caret beside a widget, where it flashes taller. */
	pressed(): boolean;
}

export interface DrawnCaret {
	/** Paints once this task's flush has landed; a second call in the task adds nothing. */
	request(): void;
	/** Returns the unregister, for the editable's teardown; it releases the owner's widget edge. */
	register(source: CaretSource): () => void;
	/** Holds the widget edge a click meant, one per editor; null releases it if `owner` holds it. */
	armWidgetEdge(owner: object, offset: number | null): void;
	/** The offset `owner` holds, or null; a plain read, outside any effect. */
	widgetEdgeFor(owner: object): number | null;
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

/** Whether this editor draws its text caret, read at each paint: the `caret` prop, and for `auto`
 *  the primary pointer. */
export function drawsCaret(mode: CaretMode, media: CaretMedia | null): boolean {
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
	let drawnAt = '';
	let drawnPosition = '';
	let drawnIn: Element | null = null;
	let drawnState = '';
	let drawnMarks = '';
	let blink: 'a' | 'b' = 'a';
	const widgetEdge = createWidgetEdgeHolder(request);
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
		paint(true);
	}

	function paint(atFrame = false): void {
		const root = deps.getRoot();
		if (!root) return;
		countCaretPaint();
		const read = readCaret(root);
		const target = drawnCaretTarget(read.reads);
		draw(target, read, atFrame);
		assertInvariant('one-caret-showing', () =>
			checkOneCaretShowing(root, DRAWN_ATTR, target, read.source?.el ?? null)
		);
	}

	function readCaret(root: HTMLElement): CaretRead {
		const sel = window.getSelection();
		const active = document.activeElement;
		const source = active instanceof HTMLElement ? (sources.get(active) ?? null) : null;
		const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
		// A widget edge holds even where the browser dropped its range.
		const owned = source && (!range || source.el.contains(range.startContainer)) ? source : null;
		const draws = drawsCaret(deps.caretMode(), media);
		const drawable = owned?.drawable() ?? false;
		const gapHost = owned?.gapHost ?? null;
		const edge = owned && !gapHost ? readWidgetEdge(owned) : null;
		const atText = owned && range?.collapsed && drawable && !edge && !gapHost;
		// The browser can't draw a chip's outside stop, so a chip edge is measured whatever the prop.
		const measured =
			atText && (draws || codeChipEdge(range, owned.el)) ? measureCaret(owned.el, range) : null;
		const host = gapHost ?? measured?.host ?? (edge && owned ? caretHost(owned.el) : null);
		// The side of a chip's border is what the next letter does, so the look says which.
		const chipLook = measured?.chipEdge && range ? owned?.look?.(range) : null;
		const chip =
			measured?.chipEdge && chipLook
				? chipStopBox(measured.chipEdge, chipLook.boxed ? 'inside' : 'outside')
				: null;
		const { selection } = deps;
		return {
			source: owned,
			range,
			host,
			reads: {
				draws,
				forcedColors: media?.forcedColors.current ?? false,
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
				gap: gapHost !== null,
				widgetEdge: edge,
				besideWidget: measured?.besideWidget ?? false,
				atSoftWrap: measured?.atSoftWrap ?? false,
				clipped: measured?.clipped ?? false,
				atCodeChipEdge: !!measured?.chipEdge,
				chip,
				caret: measured?.caret ?? null,
				host: measured?.hostBox ?? (edge && host ? hostBox(host) : null),
				devicePixelRatio: window.devicePixelRatio || 1
			}
		};
	}

	function readWidgetEdge(source: CaretSource): DrawnCaretReads['widgetEdge'] {
		const edges = source.widgetEdge;
		if (!edges) return null;
		const offset = widgetEdge.heldFor(edges.owner);
		const box = offset === null ? null : edges.box(offset);
		if (box) return { box };
		return edges.pressed() ? { box: null } : null;
	}

	function draw(target: DrawnCaretTarget, read: CaretRead, atFrame: boolean): void {
		markDrawnFor(hidesBrowserCaret(target) ? (read.source?.el ?? null) : null);
		const rect = 'rect' in target ? target.rect : null;
		if ((!rect && target.state !== 'gap') || !read.host) {
			if (bar) markState(bar, target.state);
			if (bar) bar.hidden = true;
			painted = null;
			drawnAt = '';
			return;
		}
		const el = (bar ??= createBar());
		if (el.parentElement !== read.host) read.host.appendChild(el);
		// Only a caret in text has a look: beside a widget, across a gap or hidden, the bar is plain.
		const inText = target.state === 'text' || target.state === 'chip';
		const look = inText && read.range ? read.source?.look?.(read.range) : null;
		const marks = look?.marks.join(' ') ?? '';
		// The gap bar's box is all CSS, across its whole element. The stylesheet owns `transform`.
		const translate = rect ? `${rect.x}px ${rect.y}px` : '';
		const height = rect ? `${rect.height}px` : '';
		const width = rect && 'width' in rect ? `${rect.width}px` : '';
		const position = `${target.state} ${translate} ${height} ${width}`;
		const at = `${position} ${marks}`;
		if (at !== drawnAt || el.parentElement !== drawnIn) {
			// An editor-made move is painted by its own request; one the frame finds is the browser's.
			// A new look alone isn't a move.
			const moved = position !== drawnPosition || el.parentElement !== drawnIn;
			if (atFrame && drawnAt && moved) recordCaretFrameMove();
			el.style.translate = translate;
			el.style.height = height;
			el.style.width = width;
			if (marks !== drawnMarks) {
				if (marks) el.setAttribute('data-caret-marks', marks);
				else el.removeAttribute('data-caret-marks');
				drawnMarks = marks;
			}
			// Two identical keyframe names: switching restarts the blink, so a moved caret or a new
			// look shows solid.
			blink = blink === 'a' ? 'b' : 'a';
			el.setAttribute('data-blink', blink);
			drawnAt = at;
			drawnPosition = position;
			drawnIn = el.parentElement;
		}
		markState(el, target.state);
		el.hidden = false;
		painted =
			target.state === 'text' && read.source && read.range
				? {
						node: read.range.startContainer,
						offset: read.range.startOffset,
						rect: target.rect,
						surface: read.source.el,
						surfaceSize: sizeOf(read.source.el)
					}
				: null;
		if (read.source) watchSurface(read.source.el);
	}

	function markState(el: HTMLElement, state: string): void {
		if (state === drawnState) return;
		el.setAttribute('data-caret-state', state);
		drawnState = state;
	}

	function markDrawnFor(el: HTMLElement | null): void {
		if (drawnFor === el) return;
		drawnFor?.removeAttribute(DRAWN_ATTR);
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

	// A scroller between the caret's editable and its host (a wide table, a code block) moves the
	// caret, drawn or clipped; the page's own scroll moves the block and the bar together.
	function onScroll(e: Event): void {
		const active = document.activeElement;
		const scroller = e.target;
		if (!(active instanceof HTMLElement) || !(scroller instanceof Node)) return;
		const between = scroller.contains(active) && caretHost(active)?.contains(scroller);
		if (between && sources.has(active)) request();
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
			drawnAt = '';
			drawnPosition = '';
			drawnIn = null;
			drawnState = '';
			drawnMarks = '';
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
			// No paint: the caret reaches a new editable through a caret write or `focusin`, each of
			// which asks for one.
			sources.set(source.el, source);
			return () => {
				if (sources.get(source.el) === source) sources.delete(source.el);
				if (source.widgetEdge) widgetEdge.release(source.widgetEdge.owner);
			};
		},
		armWidgetEdge: widgetEdge.arm,
		widgetEdgeFor: widgetEdge.heldFor
	};
}

/** The one widget edge an editor holds, keyed by its owner; `onChange` hears every `arm` that
 *  changes it, and `release` changes it silently. */
export function createWidgetEdgeHolder(onChange: () => void) {
	let held: { owner: object; offset: number } | null = null;
	return {
		arm(owner: object, offset: number | null): void {
			const holds = held?.owner === owner;
			if (offset === null ? !holds : holds && held?.offset === offset) return;
			held = offset === null ? null : { owner, offset };
			onChange();
		},
		heldFor(owner: object): number | null {
			return held?.owner === owner ? held.offset : null;
		},
		/** For a torn-down owner, whose edge nothing will draw again. */
		release(owner: object): void {
			if (held?.owner === owner) held = null;
		}
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/** On the editable the bar draws for, hiding the browser's caret there and only there. An
 *  attribute, not a class: Svelte rewrites an editable's whole class list when its kind changes. */
const DRAWN_ATTR = 'data-caret-drawn';

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
