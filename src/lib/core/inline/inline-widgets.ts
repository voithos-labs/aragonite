/**
 * Registry of inline node kinds that render as live atomic widgets
 * (contenteditable=false islands marked [data-inline-widget]). Single source of
 * truth for "is this inline node a live widget, and how is its widget-ness
 * recognized." Recognition is registry-owned; DOM building dispatches by layer:
 * core-built widgets (e.g. <br>) carry a builder here; the image widget builder
 * is injected per-render (it holds per-instance state) and registers no builder.
 */

import type { AnyInlineKind, CstNode, InlineNode } from '../nodes';
import { isLiveHtmlTag, buildLiveHtmlWidget } from './raw-html-widget';

/** Per-kind editing behavior for a live inline widget. */
export interface InlineWidgetEditingPolicy {
	deleteGranularity: 'atomic' | 'select-then-delete';
	onEdge: 'select' | 'step-over';
	revealSource?: boolean;
	onSelectedKey?: (e: KeyboardEvent, ctx: InlineWidgetEditingContext) => boolean;
}

/** What a widget kind's key handler is given about the selected widget instance. */
export interface InlineWidgetEditingContext {
	node: CstNode;
	inline: InlineNode;
	widgetStart: number;
	widgetEnd: number;
	index: number;
	preSelectOffset: number;
	editorContentWidth: number;
	/** Core-safe commit hook: this module can't reach the editor-actions block API
	 *  from the core layer, so the caller binds this to its content update. */
	updateContent: (newRaw: string, caretBefore: number, caretAfter: number) => void;
}

export interface InlineWidgetDescriptor {
	/** True when a node of this kind renders as a live widget given its raw slice. */
	isWidget(node: InlineNode, raw: string): boolean;
	/** Core widget DOM builder. Omitted for kinds whose builder is injected
	 *  per-render (image). */
	buildWidget?(node: InlineNode, raw: string): HTMLElement;
	editing?: InlineWidgetEditingPolicy;
}

const registry = new Map<AnyInlineKind, InlineWidgetDescriptor>();

export function registerInlineWidgetKind(
	kind: AnyInlineKind,
	descriptor: InlineWidgetDescriptor
): void {
	if (registry.has(kind)) {
		throw new Error(
			`registerInlineWidgetKind: "${kind}" is already registered. Inline-widget kinds are ` +
				`register-once — a re-registration would clobber a built-in (image/rawHtml).`
		);
	}
	registry.set(kind, descriptor);
}

/** Kind-level recognition — independent of per-block render policy (e.g.
 *  renderImagesAsWidgets). */
export function isInlineWidget(node: InlineNode, raw: string): boolean {
	const descriptor = registry.get(node.kind);
	return descriptor ? descriptor.isWidget(node, raw) : false;
}

/** Editing policy for a widget kind, or undefined when the kind is unregistered
 *  or declares no policy. */
export function getInlineWidgetEditing(kind: AnyInlineKind): InlineWidgetEditingPolicy | undefined {
	return registry.get(kind)?.editing;
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
	isWidget: () => true,
	editing: { deleteGranularity: 'select-then-delete', onEdge: 'select' }
});

registerInlineWidgetKind('rawHtml', {
	isWidget: (node, raw) => isLiveHtmlTag(raw.slice(node.start, node.end)),
	buildWidget: (node) => buildLiveHtmlWidget(node),
	editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
});

// Snapshot the built-in kinds after their module-load registration; the test
// reset keeps these and drops only plugin-registered kinds.
const BUILTIN_INLINE_WIDGET_KINDS: ReadonlySet<AnyInlineKind> = new Set(registry.keys());

/** Test-only. Removes every plugin-registered inline-widget kind; built-ins survive. */
export function __resetInlineWidgetsForTests(): void {
	for (const kind of registry.keys()) {
		if (!BUILTIN_INLINE_WIDGET_KINDS.has(kind)) registry.delete(kind);
	}
}
