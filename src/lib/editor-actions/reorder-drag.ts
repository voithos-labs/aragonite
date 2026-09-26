/**
 * Drag-to-reorder with the pointer: one capture-phase pointerdown listener on the editor
 * root, a ghost and an insertion line while dragging (no tree change, no reflow), and one
 * move committed on drop. The drop index is resolved against the mounted siblings only;
 * autoscroll brings the others into view.
 */

import type { UserScrollport } from '../cursor/scroll-ancestors';
import type { ReorderAction } from './reorder-action';
import { createPointerDragSession } from '../selection/pointer-session';
import { readBlockPath } from '../selection/path-lookup';
import type { DocumentGetter } from '../editor-keys';
import { isImageOnlyParagraph } from '../core/inline/picture';
import type { InlineReading } from '../core/inline/inline-cache';
import type { NodeView } from '../core/node-views';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

export interface ReorderDragOverlay {
	setGhost(g: { clientX: number; clientY: number; label: string } | null): void;
	setLine(l: { left: number; top: number; width: number } | null): void;
}

export interface ReorderDragContext {
	editorRoot: HTMLElement;
	/** What autoscrolls when the drag reaches an edge: the root in self mode, the host's
	 *  scroll container in host mode (where the root does not scroll), the window when the
	 *  page scrolls. Never `editorRoot` directly (`cursor/scroll-ancestors`). */
	getScrollHost: () => UserScrollport | null;
	moveReorderUnit: ReorderAction['moveReorderUnit'];
	overlay: ReorderDragOverlay;
	/** The document and its reading, which name the dragged block on the ghost. */
	getDoc: DocumentGetter;
	reading: InlineReading;
	/** Aborted on editor unmount, ending a drag whose pointerup can no longer fire. */
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
		// Capture phase plus stopPropagation, so the block's own pointerdown never starts a
		// cross-block text selection; preventDefault keeps the handle from taking focus.
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
	const node = blockNodeAt(ctx.getDoc(), fromPath);
	const label = node ? ghostLabel(dragHost, node, ctx.reading) : 'Block';
	// The container this unit moves within (null at top level). Marked for the drag's
	// duration so a move confined to it reads as intentional, not broken.
	const scopeEl = scopeBox(group);

	let dropTo: number | null = null;

	function siblings(): { index: number; rect: DOMRect }[] {
		const out: { index: number; rect: DOMRect }[] = [];
		for (const el of Array.from(group!.children)) {
			if (!(el instanceof HTMLElement)) continue;
			if (!el.classList.contains('reorder-host')) continue;
			const index = indexOf(el);
			if (index !== null) out.push({ index, rect: el.getBoundingClientRect() });
		}
		out.sort((a, b) => a.index - b.index);
		return out;
	}

	function process(clientX: number, clientY: number): void {
		const sibs = siblings();
		// rawR is the original index to drop before. Removing the dragged item shifts later
		// indices down by one, hence the adjustment so a downward drop lands where the line
		// showed.
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
				// A drop commits only on release, never on cancel, Escape or unmount.
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
			// Draw from the pointer-down point before any move, so a release without moving
			// still commits a drop.
			process(down.clientX, down.clientY);
		}
	};
}

// ── Element → path / index ───────────────────────────────────────────────────

// A `.list-item-block` carries no `data-block-path`, so borrow a descendant block-host's;
// resolveReorderUnit climbs back to the list item either way.
function pathFor(host: HTMLElement): number[] | null {
	if (host.getAttribute('data-block-path')) return readBlockPath(host);
	return readBlockPath(host.querySelector('[data-block-path]'));
}

// A block-host's own path tail; for a list item, its inner content path's
// second-to-last entry.
function indexOf(host: HTMLElement): number | null {
	if (host.getAttribute('data-block-path')) return readBlockPath(host)?.at(-1) ?? null;
	return readBlockPath(host.querySelector('[data-block-path]'))?.at(-2) ?? null;
}

/**
 * The ghost's label: a table's shape, the name a kind declares for a block whose text reads badly
 * as one (a formula's source), and otherwise the block's first words.
 */
function ghostLabel(host: HTMLElement, node: NodeView, reading: InlineReading): string {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	if (descriptor?.containerContract === 'grid') return tableLabel(host);
	if (descriptor?.dragLabel) return descriptor.dragLabel;
	const text = (host.textContent ?? '').trim().replace(/\s+/g, ' ');
	if (!text) return isImageOnlyParagraph(node, reading) ? 'Image' : 'Block';
	return text.length > 40 ? text.slice(0, 40) + '…' : text;
}

/**
 * The box a drag inside a container is confined to: the whole container as drawn (a quote's bar
 * and padding included), found from the child list marked as one whose children reorder.
 */
function scopeBox(group: HTMLElement): HTMLElement | null {
	if (!group.hasAttribute('data-reorder-scope')) return null;
	const host = group.parentElement?.closest('.block-host');
	if (!host) return null;
	return (
		Array.from(host.children).find((child): child is HTMLElement => child.contains(group)) ?? null
	);
}

/** Rows by columns: the shape is what tells one table from another at a glance. */
function tableLabel(host: HTMLElement): string {
	const rows = host.querySelectorAll('.table-row').length;
	const cols = host.querySelector('.table-row')?.childElementCount ?? 0;
	if (rows === 0 || cols === 0) return 'Table';
	return `Table · ${rows} × ${cols}`;
}
