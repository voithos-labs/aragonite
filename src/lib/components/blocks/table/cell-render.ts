/**
 * DOM-build for TableCellBlock's render $effect. Mirrors text-render.ts but
 * without ambient prefix or block marker — a cell's entire raw is content, so
 * every island offset is a raw offset (ambient length 0). The component owns the
 * effect (the reactivity entry point) and the pending-cursor restore that touches
 * $state; this factory owns the imperative build and carries a focused caret
 * across an island-driven rebuild the SFC's pending restore doesn't cover.
 */

import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { LinkReferenceResolverRef, ResolveLinkUrl } from '../../../editor-keys';
import { computeInlineContent } from '../../../core/inline';
import { renderInlineNodes } from '../../../core/inline-render';
import { trimTrailingLineEnding } from '../../../core/lines';
import {
	captureFocusedCaretWalkOffset,
	restoreCaretAtWalkOffset
} from '../../../cursor/focused-caret';
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
	/** Position-sorted islands for this cell. A getter, read inside the render
	 *  pass on purpose: that read is the reactive dependency that re-renders the
	 *  cell when its island set changes. */
	get islands(): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	/** A widget component's synchronous mount throw is routed here — the editor's
	 *  `error` channel, matching BlockHost's render-boundary origin. Absent → errors
	 *  are not surfaced (the widget still falls back to its raw source). */
	reportRenderError?: (error: unknown) => void;
}

export interface CellRender {
	/**
	 * Rebuild the cell's children from current node state. Skips work when the
	 * memo key (raw + signature-for-reference-cells + island signature) is
	 * unchanged, unless `forceRebuild` is set — pass it when a pending cursor
	 * restore needs the DOM positions re-anchored even though the key didn't change.
	 */
	render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void;
	/** Destroy every pooled widget instance and mounted island — called on unmount. */
	dispose(): void;
}

export function createCellRender(deps: CellRenderDeps): CellRender {
	let lastRenderedKey = '';
	const widgetPool = createSvelteWidgetPool(deps.reportRenderError);
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

		// A cell resolves through an LRD only if it contains a bracket. Gate both
		// the signature dependency and the resolver read on it, so a bracketless
		// cell never subscribes to the resolver and an LRD change can't re-render
		// every cell in the document. A false positive merely re-parses to
		// identical output.
		const hasRef = node.raw.includes('[');
		// Key on the compact signature epoch, never the ~MB-scale string (text-render's twin).
		const sig = hasRef ? String(deps.linkRef?.epoch ?? deps.linkRef?.signature ?? '') : '';
		const islands = deps.islands;
		const renderKey = `${node.raw}\0${sig}${islandRenderKeyPart(islands)}`;
		const forceRebuild = opts?.forceRebuild ?? false;
		if (renderKey === lastRenderedKey && !forceRebuild) return;

		const content = computeInlineContent(node, hasRef ? deps.linkRef?.current : undefined);
		// An island-signature change rebuilds a focused cell's DOM with no edit-path
		// pending offset; carry the caret across in walk space. The edit path passes
		// carryCaret: false — its pending restore runs after and wins, so the walk
		// would be dead work (text-render's twin).
		const caretWalkOffset = (opts?.carryCaret ?? true) ? captureFocusedCaretWalkOffset(el) : null;
		// Bracket the rebuild so portal widgets in the cell are pooled — an unchanged
		// `$…$` keeps its mounted instance across the cell's per-keystroke rebuild.
		// Island widgets are unpooled: destroy last pass's, mount this pass's.
		widgetPool.beginPass();
		destroyIslands();
		el.replaceChildren(
			renderInlineNodes(content, node.raw, {
				renderImagesAsWidgets: getBlockKindDescriptor(node.kind).renderImagesAsWidgets ?? true,
				resolveLinkUrl: deps.resolveLinkUrl,
				buildPortalWidget
			})
		);
		// Ambient length 0: a cell carries no marker, so every island offset is a raw
		// offset that the shared walk reads back byte-exact.
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
