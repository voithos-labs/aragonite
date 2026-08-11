/**
 * DOM-build for TableCellBlock's render $effect. Mirrors text-render.ts without the
 * ambient prefix or block marker — a cell's entire raw is content, so every island
 * offset is a raw offset. The component owns the effect and the pending-cursor
 * restore; this factory owns the imperative build.
 */

import type { InlineNode } from '../../../core/nodes';
import type { DocumentView, NodeView } from '../../../core/node-views';
import type { LinkReferenceResolverRef, ResolveLinkUrl } from '../../../editor-keys';
import { computeInlineContent } from '../../../core/inline';
import { renderInlineNodes } from '../../../core/inline-render';
import { trimTrailingLineEnding } from '../../../core/lines';
import {
	captureFocusedCaretWalkOffset,
	restoreCaretAtWalkOffset
} from '../../../cursor/focused-caret';
import { CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome } from '../../../cursor/widget-offset';
import type { IndexedDecoration } from '../../../decorations/buckets';
import { applyIslandDecorations, islandRenderKeyPart } from '../../../decorations/island-dom';
import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
import { mountDecorationWidget } from '../../../decorations/widget-dom';
import { devWarn } from '../../../dev-warn';
import { getBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
import { createSvelteWidgetPool } from '../widget-portal';

export interface CellRenderDeps {
	get el(): HTMLElement | null;
	get node(): NodeView;
	get linkRef(): LinkReferenceResolverRef | undefined;
	resolveLinkUrl: ResolveLinkUrl;
	/** Live root document for widgets that derive from it. A getter, so a pooled widget
	 *  re-reads the current document across edits rather than a mount-time snapshot. */
	getDocument: () => DocumentView | undefined;
	/** The editor's content version, so a widget can memoize a document-wide derivation
	 *  on it. Absent in a bare harness. */
	getContentVersion?: () => number;
	/** Position-sorted islands. A getter read inside the render pass on purpose: that
	 *  read is the reactive dependency that re-renders the cell on an island change. */
	get islands(): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	/** A widget's synchronous mount throw goes to the editor's `error` channel. Absent →
	 *  unsurfaced; the widget still falls back to its raw source. */
	reportRenderError?: (error: unknown) => void;
}

export interface CellRender {
	/**
	 * Rebuild the cell's children from current node state. Skips work on an unchanged
	 * memo key unless `forceRebuild` — pass it when a pending cursor restore needs the
	 * DOM re-anchored even though the key held.
	 */
	render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void;
	/** Destroy every pooled widget instance and mounted island — called on unmount. */
	dispose(): void;
}

export function createCellRender(deps: CellRenderDeps): CellRender {
	let lastRenderedKey = '';
	const widgetPool = createSvelteWidgetPool({
		reportError: deps.reportRenderError,
		getDocument: deps.getDocument,
		getContentVersion: deps.getContentVersion
	});
	let islandDestroys: Array<() => void> = [];

	function destroyIslands(): void {
		for (const destroy of islandDestroys) destroy();
		islandDestroys = [];
	}

	function buildPortalWidget(node: InlineNode, raw: string): HTMLElement | null {
		return widgetPool.acquire(node.kind, node, raw.slice(node.start, node.end));
	}

	function render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void {
		const el = deps.el;
		if (!el) return;
		const node = deps.node;

		// Gating both the signature dependency and the resolver read on the bracket keeps
		// an LRD change from re-rendering every cell. A false positive re-parses identically.
		const hasRef = node.raw.includes('[');
		// Key on the compact signature epoch, never the ~MB-scale string (text-render's twin).
		const sig = hasRef ? String(deps.linkRef?.epoch ?? deps.linkRef?.signature ?? '') : '';
		const islands = deps.islands;
		const renderKey = `${node.raw}\0${sig}${islandRenderKeyPart(islands)}`;
		const forceRebuild = opts?.forceRebuild ?? false;
		if (renderKey === lastRenderedKey && !forceRebuild) return;

		const content = computeInlineContent(node, hasRef ? deps.linkRef?.current : undefined);
		// An island-signature change rebuilds a focused cell with no edit-path pending
		// offset, so carry the caret in walk space; the edit path opts out because its
		// own restore runs after and wins (text-render's twin).
		const caretWalkOffset = (opts?.carryCaret ?? true) ? captureFocusedCaretWalkOffset(el) : null;
		// Bracketing the rebuild pools portal widgets, so an unchanged `$…$` keeps its
		// instance across per-keystroke rebuilds. Island widgets are unpooled.
		widgetPool.beginPass();
		destroyIslands();
		el.replaceChildren(
			renderInlineNodes(content, node.raw, {
				renderImagesAsWidgets: getBlockKindDescriptor(node.kind).renderImagesAsWidgets ?? true,
				resolveLinkUrl: deps.resolveLinkUrl,
				buildPortalWidget
			})
		);
		// Ambient length 0: a cell carries no marker, so island offsets are raw offsets.
		islandDestroys = applyIslandDecorations(el, node.raw, islands, {
			ambientLength: 0,
			mountWidget: (spec, dec) => mountDecorationWidget(spec, dec, deps.reportRenderError),
			onSkipped: (dec, reason) => devWarn('decorations', `island skipped: ${reason}`, dec)
		});
		widgetPool.sweep();
		lastRenderedKey = renderKey;

		// An empty cell needs a `<br>` caret anchor, but a `<br>` inside an island
		// belongs to the widget, not the cell — it must not satisfy the anchor.
		if (trimTrailingLineEnding(node.raw) === '') {
			const hasAnchorBr = [...el.querySelectorAll('br')].some(
				(br) => !br.closest('[data-decoration-island]')
			);
			if (!hasAnchorBr) el.appendChild(document.createElement('br'));
		}

		// A cell whose whole content is an empty construct (`****`) would otherwise paint
		// nothing; the stamp precedes the restore, which lands through the same walk.
		el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));

		if (caretWalkOffset !== null) restoreCaretAtWalkOffset(el, caretWalkOffset);
	}

	return {
		render,
		dispose: () => {
			destroyIslands();
			widgetPool.dispose();
		}
	};
}
