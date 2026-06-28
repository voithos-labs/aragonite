/**
 * Registry of inline node kinds that render as live atomic widgets
 * (contenteditable=false islands marked [data-inline-widget]). Single source of
 * truth for "is this inline node a live widget, and how is its widget-ness
 * recognized." Recognition is registry-owned; DOM building dispatches by layer:
 * core-built widgets (e.g. <br>) carry a builder here; the image widget builder
 * is injected per-render (it holds per-instance state) and registers no builder.
 */

import type { InlineNode } from '../nodes';
import { isLiveHtmlTag, buildLiveHtmlWidget } from './raw-html-widget';

export interface InlineWidgetDescriptor {
	/** True when a node of this kind renders as a live widget given its raw slice. */
	isWidget(node: InlineNode, raw: string): boolean;
	/** Core widget DOM builder. Omitted for kinds whose builder is injected
	 *  per-render (image). */
	buildWidget?(node: InlineNode, raw: string): HTMLElement;
}

const registry = new Map<InlineNode['kind'], InlineWidgetDescriptor>();

export function registerInlineWidgetKind(
	kind: InlineNode['kind'],
	descriptor: InlineWidgetDescriptor
): void {
	registry.set(kind, descriptor);
}

/** Kind-level recognition — independent of per-block render policy (e.g.
 *  renderImagesAsWidgets). */
export function isInlineWidget(node: InlineNode, raw: string): boolean {
	const descriptor = registry.get(node.kind);
	return descriptor ? descriptor.isWidget(node, raw) : false;
}

/**
 * Every live widget node reachable from `nodes`, in document order. Recurses
 * into children so a widget nested inside a non-widget container — e.g. the
 * image in `[![alt][ref]][repo]`, whose `image` node is a child of the `link`
 * node — is found, not just the top-level widgets. A widget is atomic, so its
 * own children are not descended into. `raw` is the enclosing block's source;
 * widget recognition keys on each node's absolute `start`/`end` into it.
 */
export function flattenInlineWidgets(nodes: ReadonlyArray<InlineNode>, raw: string): InlineNode[] {
	const out: InlineNode[] = [];
	const visit = (list: ReadonlyArray<InlineNode>) => {
		for (const node of list) {
			if (isInlineWidget(node, raw)) {
				out.push(node);
				continue;
			}
			if (node.children) visit(node.children);
		}
	};
	visit(nodes);
	return out;
}

/** Build a core-layer widget's DOM, or null when the node is not a widget or its
 *  kind builds via an injected per-render builder (image). */
export function buildCoreInlineWidget(node: InlineNode, raw: string): HTMLElement | null {
	const descriptor = registry.get(node.kind);
	if (!descriptor || !descriptor.buildWidget || !descriptor.isWidget(node, raw)) return null;
	return descriptor.buildWidget(node, raw);
}

registerInlineWidgetKind('image', {
	isWidget: () => true
});

registerInlineWidgetKind('rawHtml', {
	isWidget: (node, raw) => isLiveHtmlTag(raw.slice(node.start, node.end)),
	buildWidget: (node) => buildLiveHtmlWidget(node)
});
