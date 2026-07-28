/**
 * Pointer drag-to-reorder. One delegated capture-phase pointerdown on the editor
 * root starts a drag from any `.block-drag-handle`; a shared
 * `createPointerDragSession` then tracks the pointer, paints a ghost + a single
 * insertion line (no tree mutation, no reflow), and commits ONE move on drop.
 *
 * Baseline targeting only: the drop index is resolved against currently-mounted
 * siblings; autoscroll brings off-viewport siblings into the window. Precise
 * off-window (spacer-region) targeting is a separate layer.
 */

import type { ReorderAction } from './reorder-action';
import { createPointerDragSession } from '../selection/pointer-session';
import { readBlockPath } from '../selection/path-lookup';

export interface ReorderDragOverlay {
	setGhost(g: { clientX: number; clientY: number; label: string } | null): void;
	setLine(l: { left: number; top: number; width: number } | null): void;
}

export interface ReorderDragContext {
	editorRoot: HTMLElement;
	/** What autoscrolls when the drag reaches an edge: the root in self mode, the
	 *  host's scroller in host mode (where the root doesn't scroll), null when
	 *  nothing does. Never `editorRoot` directly — see `cursor/scroll-ancestors`. */
	getScrollHost: () => HTMLElement | null;
	moveReorderUnit: ReorderAction['moveReorderUnit'];
	overlay: ReorderDragOverlay;
	/** Aborted on editor unmount — tears down a drag whose pointerup can't fire. */
	lifetimeSignal?: AbortSignal;
}

export function installReorderDrag(ctx: ReorderDragContext): { dispose(): void } {
	const root = ctx.editorRoot;

	function onPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.block-drag-handle')) return;
		const dragHost = target.closest('.reorder-host') as HTMLElement | null;
		if (!dragHost) return;
		const session = startSession(ctx, dragHost);
		if (!session) return;
		// Capture-phase + stopPropagation so the block's own pointerdown (which
		// would start a cross-block text selection) never fires; preventDefault
		// keeps the handle from stealing focus / starting a native selection.
		e.preventDefault();
		e.stopPropagation();
		session.begin(e);
	}

	root.addEventListener('pointerdown', onPointerDown, true);

	let disposed = false;
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		root.removeEventListener('pointerdown', onPointerDown, true);
	}
	if (ctx.lifetimeSignal) {
		if (ctx.lifetimeSignal.aborted) {
			dispose();
			return { dispose };
		}
		ctx.lifetimeSignal.addEventListener('abort', dispose, { once: true });
	}
	return { dispose };
}

// ── Drag session ─────────────────────────────────────────────────────────────

function startSession(
	ctx: ReorderDragContext,
	dragHost: HTMLElement
): { begin(e: PointerEvent): void } | null {
	const fromPath = pathFor(dragHost);
	const fromIndex = indexOf(dragHost);
	const group = dragHost.parentElement;
	if (!fromPath || fromIndex === null || !group) return null;
	const siblingSelector = dragHost.classList.contains('list-item-block')
		? '.list-item-block'
		: '.block-host';
	const label = ghostLabel(dragHost);
	// The container this unit reorders within (null for a top-level block, whose
	// scope IS the document). Marked for the drag's duration so the scope-locked
	// reorder reads as "reorder within this list/quote" rather than broken.
	const scopeEl = dragHost.closest('.list-block, .blockquote-block') as HTMLElement | null;

	let dropTo: number | null = null;

	function siblings(): { index: number; rect: DOMRect }[] {
		const out: { index: number; rect: DOMRect }[] = [];
		for (const el of Array.from(group!.children)) {
			if (!(el instanceof HTMLElement)) continue;
			if (!el.matches(siblingSelector) || !el.classList.contains('reorder-host')) continue;
			const index = indexOf(el);
			if (index !== null) out.push({ index, rect: el.getBoundingClientRect() });
		}
		out.sort((a, b) => a.index - b.index);
		return out;
	}

	function process(clientX: number, clientY: number): void {
		const sibs = siblings();
		// rawR = the original index before which to drop (first sibling whose
		// vertical midpoint is below the pointer; else past the last). Removing the
		// dragged item shifts later indices down by one, hence the `> fromIndex`
		// adjustment so a downward drop lands where the line showed.
		let rawR = sibs.length ? sibs[sibs.length - 1].index + 1 : fromIndex! + 1;
		let line = sibs.length
			? {
					left: sibs[sibs.length - 1].rect.left,
					top: sibs[sibs.length - 1].rect.bottom,
					width: sibs[sibs.length - 1].rect.width
				}
			: null;
		for (const s of sibs) {
			if (clientY < s.rect.top + s.rect.height / 2) {
				rawR = s.index;
				line = { left: s.rect.left, top: s.rect.top, width: s.rect.width };
				break;
			}
		}
		dropTo = rawR <= fromIndex! ? rawR : rawR - 1;
		ctx.overlay.setGhost({ clientX, clientY, label });
		if (line) ctx.overlay.setLine(line);
	}

	return {
		begin(down: PointerEvent) {
			scopeEl?.classList.add('reorder-scope');
			createPointerDragSession(down, {
				onMove: (p) => process(p.clientX, p.clientY),
				// A drop commits only on release (never cancel/Escape/unmount); dropTo
				// is the flushed value the session's final onMove settled.
				onEnd: (reason) => {
					if (reason === 'up' && dropTo !== null && dropTo !== fromIndex) {
						void ctx.moveReorderUnit(fromPath!, dropTo);
					}
				},
				onTeardown: () => {
					scopeEl?.classList.remove('reorder-scope');
					ctx.overlay.setGhost(null);
					ctx.overlay.setLine(null);
				},
				autoScroll: {
					getTargets: () => {
						const host = ctx.getScrollHost();
						return host ? [host] : [];
					}
				},
				escape: true,
				disableUserSelect: true,
				lifetimeSignal: ctx.lifetimeSignal
			});
			// Paint the initial line from the press point before any move; a no-move
			// release then commits this drop just like a dragged one.
			process(down.clientX, down.clientY);
		}
	};
}

// ── Element → path / index ───────────────────────────────────────────────────

// A `.block-host` carries its own `data-block-path`; a `.list-item-block` does
// not, so we borrow a descendant block-host's path — the action's
// resolveReorderUnit climbs from it to the list item either way.
function pathFor(host: HTMLElement): number[] | null {
	if (host.getAttribute('data-block-path')) return readBlockPath(host);
	return readBlockPath(host.querySelector('[data-block-path]'));
}

// The unit's index among its siblings: a block-host's own path tail; a list
// item's inner content path's second-to-last entry (the item index).
function indexOf(host: HTMLElement): number | null {
	if (host.getAttribute('data-block-path')) return readBlockPath(host)?.at(-1) ?? null;
	return readBlockPath(host.querySelector('[data-block-path]'))?.at(-2) ?? null;
}

function ghostLabel(host: HTMLElement): string {
	const text = (host.textContent ?? '').trim().replace(/\s+/g, ' ');
	if (!text) return 'block';
	return text.length > 40 ? text.slice(0, 40) + '…' : text;
}
