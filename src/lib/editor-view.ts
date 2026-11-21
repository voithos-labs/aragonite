/**
 * Where the document sits on screen, in document bytes: a block's box, a range's boxes, the
 * caret's box, the byte under a point, a scroll that brings a block into view, and an element
 * pinned over a block. What `editor.view` hands a plugin and a host. The geometry comes from the
 * same rect reads the editor's own menus measure with, so the two never disagree.
 *
 * An overlay lives in a layer inside the editor's scroll content, so it scrolls with the document
 * and wears its theme, and the editor treats what's in it as the host's, as it does the header. It
 * holds its block as a plugin holds one: once a write replaces the block, it comes off.
 */
import { tick } from 'svelte';
import type { Block } from './schema/doc-view';
import type { EditorView, View } from './schema/view';
import type { EditorRects } from './editor-rects';
import type { DocumentRead } from './editor-actions/commit/document-read';
import type { CaretTarget } from './schema/block-kind-descriptor';
import type { EditorEvents } from './editor-events';

// ── Public API ───────────────────────────────────────────────────────────────

export function createEditorView(deps: {
	rects: Pick<EditorRects, 'blockRect' | 'rangeRects' | 'caretRect' | 'scrollTo'>;
	read: Pick<DocumentRead, 'blockAt' | 'byteOf' | 'leavesIn' | 'pathOf'>;
	root(): HTMLElement | null;
	/** The element overlays go in, which the editor reads as the host's. */
	layer(): HTMLElement | null;
	/** Where a click at a viewport point would land, placing nothing. */
	caretTargetAt(root: HTMLElement, x: number, y: number): CaretTarget | null;
	/** Tells `listen` when the blocks' own box changes size (a picture loads, the editor narrows),
	 *  which moves blocks with no write and no node mounted; returns the way out. */
	resized(listen: () => void): () => void;
	events: Pick<EditorEvents, 'on'>;
}): EditorView {
	const { rects, read } = deps;
	const overlays = new Map<() => void, Measure>();
	let unwatch: (() => void) | null = null;
	let pending = false;

	// Every box is read before any place is written, so a pass lays the page out once.
	function placeAll(): void {
		const layer = deps.layer();
		if (!layer || overlays.size === 0) return;
		const origin = layer.getBoundingClientRect();
		const writes = [...overlays.values()].map((measure) => measure(origin));
		for (const write of writes) write();
	}

	// A write lays the blocks out once it renders; a scroll moves the layer with them, unless it
	// windows a block in or out, which the observer hears. One pass follows however many ask.
	function settle(): void {
		if (pending) return;
		pending = true;
		void tick().then(() => {
			pending = false;
			placeAll();
		});
	}

	function watch(root: HTMLElement): () => void {
		const unhear = [deps.events.on('edit', settle), deps.events.on('sourceSwap', settle)];
		const mounts = new MutationObserver(settle);
		mounts.observe(root, { childList: true, subtree: true });
		unhear.push(deps.resized(settle));
		return () => {
			for (const stop of unhear) stop();
			mounts.disconnect();
		};
	}

	function overlay(el: HTMLElement, at: Block | number, gone?: () => void): () => void {
		const block = typeof at === 'number' ? read.blockAt(at) : at;
		const offset = typeof at === 'number' ? (block?.offsetAt(at) ?? null) : null;
		const layer = deps.layer();
		const root = deps.root();
		if (!block || !layer || !root || !read.pathOf(block)) {
			gone?.();
			return () => {};
		}

		const measure: Measure = (origin) => {
			const path = read.pathOf(block);
			if (!path) return off;
			const box =
				(offset === null ? null : rects.rangeRects([...path], offset, offset + 1)[0]) ??
				rects.blockRect([...path]);
			return () => {
				el.style.visibility = box ? '' : 'hidden';
				if (!box) return;
				el.style.left = `${box.left - origin.left}px`;
				el.style.top = `${box.top - origin.top}px`;
			};
		};

		function off(): void {
			if (!overlays.delete(off)) return;
			if (overlays.size === 0) {
				unwatch?.();
				unwatch = null;
			}
			el.remove();
			gone?.();
		}
		overlays.set(off, measure);
		unwatch ??= watch(root);
		el.style.position = 'absolute';
		layer.append(el);
		measure(layer.getBoundingClientRect())();
		return off;
	}

	const view: View = {
		boxOf(block) {
			const path = read.pathOf(block);
			return path ? rects.blockRect([...path]) : null;
		},
		boxesOf({ from, to }) {
			return read
				.leavesIn(from, to)
				.flatMap(({ path, start, end }) => rects.rangeRects(path, start, end));
		},
		caretBox: () => rects.caretRect(),
		posAt({ x, y }) {
			const root = deps.root();
			const box = root?.getBoundingClientRect();
			if (!root || !box || x < box.left || x > box.right || y < box.top || y > box.bottom)
				return null;
			const target = deps.caretTargetAt(root, x, y);
			return target && read.byteOf(target.path, target.offset);
		},
		async reveal(target, options) {
			const block = typeof target === 'number' ? read.blockAt(target) : target;
			const path = block && read.pathOf(block);
			return path ? rects.scrollTo(path, { block: options?.align ?? 'nearest' }) : false;
		},
		overlay: (el, at) => overlay(el, at)
	};

	return {
		view,
		overlay,
		dispose() {
			for (const off of [...overlays.keys()]) off();
		}
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Reads where one overlay goes, against the layer's box; the returned call writes it there. */
type Measure = (origin: DOMRect) => () => void;
