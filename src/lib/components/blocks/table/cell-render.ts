/**
 * DOM-build for TableCellBlock's render $effect. Mirrors text-render.ts but
 * without ambient prefix or block marker — a cell's entire raw is content.
 * The component owns the effect (the reactivity entry point) and the cursor
 * save/restore that touches $state; this factory owns the imperative build.
 */

import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { LinkReferenceResolverRef, ResolveLinkUrl } from '../../../editor-keys';
import { computeInlineContent } from '../../../core/inline';
import { renderInlineNodes } from '../../../core/inline-render';
import { trimTrailingLineEnding } from '../../../core/lines';
import { getBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
import { createSvelteWidgetPool } from '../widget-portal';

export interface CellRenderDeps {
	get el(): HTMLElement | null;
	get node(): NodeView;
	get linkRef(): LinkReferenceResolverRef | undefined;
	resolveLinkUrl: ResolveLinkUrl;
	/** A widget component's synchronous mount throw is routed here — the editor's
	 *  `error` channel, matching BlockHost's render-boundary origin. Absent → errors
	 *  are not surfaced (the widget still falls back to its raw source). */
	reportRenderError?: (error: unknown) => void;
}

export interface CellRender {
	/**
	 * Rebuild the cell's children from current node state. Skips work when the
	 * memo key (raw + signature-for-reference-cells) is unchanged, unless
	 * `forceRebuild` is set — pass it when a pending cursor restore needs the
	 * DOM positions re-anchored even though the key didn't change.
	 */
	render(opts?: { forceRebuild?: boolean }): void;
	/** Destroy every pooled widget instance — called when the cell unmounts. */
	dispose(): void;
}

export function createCellRender(deps: CellRenderDeps): CellRender {
	let lastRenderedKey = '';
	const widgetPool = createSvelteWidgetPool(deps.reportRenderError);

	function buildPortalWidget(node: InlineNode, raw: string): HTMLElement | null {
		return widgetPool.acquire(node.kind, node, raw.slice(node.start, node.end));
	}

	function render(opts?: { forceRebuild?: boolean }): void {
		const el = deps.el;
		if (!el) return;
		const node = deps.node;

		// A cell resolves through an LRD only if it contains a bracket. Gate both
		// the signature dependency and the resolver read on it, so a bracketless
		// cell never subscribes to the resolver and an LRD change can't re-render
		// every cell in the document. A false positive merely re-parses to
		// identical output.
		const hasRef = node.raw.includes('[');
		const sig = hasRef ? (deps.linkRef?.signature ?? '') : '';
		const renderKey = `${node.raw}\0${sig}`;
		const forceRebuild = opts?.forceRebuild ?? false;
		if (renderKey === lastRenderedKey && !forceRebuild) return;

		const content = computeInlineContent(node, hasRef ? deps.linkRef?.current : undefined);
		// Bracket the rebuild so portal widgets in the cell are pooled — an unchanged
		// `$…$` keeps its mounted instance across the cell's per-keystroke rebuild.
		widgetPool.beginPass();
		el.replaceChildren(
			renderInlineNodes(content, node.raw, {
				renderImagesAsWidgets: getBlockKindDescriptor(node.kind).renderImagesAsWidgets ?? true,
				resolveLinkUrl: deps.resolveLinkUrl,
				buildPortalWidget
			})
		);
		widgetPool.sweep();
		lastRenderedKey = renderKey;

		if (trimTrailingLineEnding(node.raw) === '' && !el.querySelector('br')) {
			el.appendChild(document.createElement('br'));
		}
	}

	return { render, dispose: () => widgetPool.dispose() };
}
