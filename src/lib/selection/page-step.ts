/**
 * Where PageUp and PageDown move a caret or a selection's moving end: one screen of the editor up
 * or down, at the column a run of vertical keys keeps, on the line there. The target block is
 * found in the height tables and mounted by path, then shown, so it is on screen when it's read.
 */

import type { BlockElLookup } from '../caret/block-el-lookup';
import type { CaretMemory } from '../caret/caret-memory';
import { editorXOf, viewportXOf } from '../caret/sticky-measure';
import { caretRectAtRaw, lineBoxNearest } from '../browser/lines';
import type { ScrollOwner } from '../windowing/scroll-owner';
import type { CaretLanding } from './caret-landing';
import { blockNearPoint } from './nearest-block';
import { pathsEqual } from './path-math';
import type { SelectionPoint } from './primitives';

export interface PageStepContext {
	getEditorRoot(): HTMLElement | null;
	getBlockElByPath: BlockElLookup;
	caretLanding: Pick<CaretLanding, 'mount'>;
	caretMemory: Pick<CaretMemory, 'column' | 'captureColumn'>;
	scroll: Pick<ScrollOwner, 'port' | 'visibleBand' | 'showRect' | 'pathAt'>;
}

// A container mounts one list level per pass; deeper than this, the deepest reached answers.
const MAX_MOUNT_DEPTH = 8;

/** The point a page up or down from `from` lands on, mounted and on screen; null where nothing is
 *  mounted to measure. `from` names a leaf the caret can sit in, with its raw offset. */
export async function pageTarget(
	ctx: PageStepContext,
	from: SelectionPoint,
	direction: 'up' | 'down'
): Promise<SelectionPoint | null> {
	const port = ctx.scroll.port();
	const band = ctx.scroll.visibleBand();
	const fromEl = ctx.getBlockElByPath(from.path);
	if (!port || !band || !fromEl) return null;
	const caret = caretRectAtRaw(fromEl, from.offset) ?? fromEl.getBoundingClientRect();
	const column = ctx.caretMemory.column() ?? editorXOf(fromEl, caret.left);
	ctx.caretMemory.captureColumn(column);

	// Kept in the scroll content, which a mount's own scroll leaves where it was.
	const page = band.bottom - band.top;
	const toContent = (clientY: number) => clientY - port.viewportTop() + port.scrollTop();
	const toClient = (contentY: number) => contentY + port.viewportTop() - port.scrollTop();
	const target = toContent(caret.top + caret.height / 2) + (direction === 'down' ? page : -page);

	const path = await mountAt(ctx, target);
	const el = path && blockElAt(ctx, path);
	if (!el) return null;
	const x = viewportXOf(el, column);
	// The line nearest the target, read again after the scroll: a block's padding holds no offset.
	const line = (): DOMRectReadOnly => {
		const near = lineBoxNearest(el, toClient(target));
		if (near) return new DOMRect(x, near.top, 1, near.bottom - near.top);
		const box = el.getBoundingClientRect();
		return new DOMRect(x, box.top, 1, box.height);
	};
	ctx.scroll.showRect(line);

	const root = ctx.getEditorRoot();
	const shown = line();
	const endpoint = root && blockNearPoint(root, x, shown.top + shown.height / 2)?.endpointHere();
	if (!endpoint) return null;
	return 'offset' in endpoint ? endpoint : { path: endpoint.path, offset: 0 };
}

/** Mounts the block at `contentY` level by level: a container's list registers only once it
 *  mounts, and only then can the tables name the child there. */
async function mountAt(ctx: PageStepContext, contentY: number): Promise<number[] | null> {
	let path = ctx.scroll.pathAt(contentY);
	for (let depth = 0; path && depth < MAX_MOUNT_DEPTH; depth++) {
		await ctx.caretLanding.mount(path);
		const deeper = ctx.scroll.pathAt(contentY);
		if (!deeper || pathsEqual(deeper, path)) return path;
		path = deeper;
	}
	return path;
}

/** The element of the block at `path`, of its first child for a table row (Firefox merges a table's
 *  lines across its rows, so the cell's is read), else of the nearest block above. */
function blockElAt(ctx: PageStepContext, path: number[]): HTMLElement | null {
	const own = ctx.getBlockElByPath(path) ?? ctx.getBlockElByPath([...path, 0]);
	if (own) return own;
	for (let depth = path.length - 1; depth > 0; depth--) {
		const el = ctx.getBlockElByPath(path.slice(0, depth));
		if (el) return el;
	}
	return null;
}
