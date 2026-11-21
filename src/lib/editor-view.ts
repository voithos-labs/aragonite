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
import { pathOfBlock, type Block } from './schema/doc-view';
import type { EditorView, View } from './schema/view';
import type { EditorRects } from './editor-rects';
import type { DocumentRead } from './editor-actions/commit/document-read';
import type { CaretTarget } from './schema/block-kind-descriptor';
import type { EditorEvents } from './editor-events';

// ── Public API ───────────────────────────────────────────────────────────────

export function createEditorView(deps: {
	rects: Pick<EditorRects, 'blockRect' | 'rangeRects' | 'caretRect' | 'scrollTo'>;
	read: Pick<DocumentRead, 'blockAt' | 'byteOf' | 'leavesIn'>;
	root(): HTMLElement | null;
	/** The element overlays go in, which the editor reads as the host's. */
	layer(): HTMLElement | null;
	/** Where a click at a viewport point would land, placing nothing. */
	caretTargetAt(root: HTMLElement, x: number, y: number): CaretTarget | null;
	events: Pick<EditorEvents, 'on'>;
}): EditorView {
	const { rects, read } = deps;
	const overlays = new Set<() => void>();

	function overlay(el: HTMLElement, at: Block | number, gone?: () => void): () => void {
		const block = typeof at === 'number' ? read.blockAt(at) : at;
		const offset = typeof at === 'number' ? (block?.offsetAt(at) ?? null) : null;
		const layer = deps.layer();
		const root = deps.root();
		if (!block || !layer || !root || !pathOfBlock(block)) {
			gone?.();
			return () => {};
		}

		function place(): void {
			const path = pathOfBlock(block!);
			if (!path) return off();
			const box =
				(offset === null ? null : rects.rangeRects([...path], offset, offset + 1)[0]) ??
				rects.blockRect([...path]);
			el.style.visibility = box ? '' : 'hidden';
			if (!box) return;
			const origin = layer!.getBoundingClientRect();
			el.style.left = `${box.left - origin.left}px`;
			el.style.top = `${box.top - origin.top}px`;
		}
		// A write lays the blocks out once it renders; a scroll moves the layer with them, unless it
		// windows a block in or out, which the observer hears.
		const settle = () => void tick().then(place);
		const unhear = [deps.events.on('edit', settle), deps.events.on('sourceSwap', settle)];
		const mounts = new MutationObserver(settle);
		mounts.observe(root, { childList: true, subtree: true });
		window.addEventListener('resize', place);

		function off(): void {
			if (!overlays.delete(off)) return;
			for (const stop of unhear) stop();
			mounts.disconnect();
			window.removeEventListener('resize', place);
			el.remove();
			gone?.();
		}
		overlays.add(off);
		el.style.position = 'absolute';
		layer.append(el);
		place();
		return off;
	}

	const view: View = {
		boxOf(block) {
			const path = pathOfBlock(block);
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
			const path = block && pathOfBlock(block);
			return path ? rects.scrollTo(path, { block: options?.align ?? 'nearest' }) : false;
		},
		overlay: (el, at) => overlay(el, at)
	};

	return {
		view,
		overlay,
		dispose() {
			for (const off of [...overlays]) off();
		}
	};
}
