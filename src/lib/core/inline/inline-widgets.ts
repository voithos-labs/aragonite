/**
 * Registry of inline node kinds that render as live atomic widgets
 * (contenteditable=false islands marked [data-inline-widget]). Single source of
 * truth for "is this inline node a live widget, and how is its widget-ness
 * recognized." Recognition is registry-owned; DOM building dispatches by layer:
 * core-built widgets (e.g. <br>) carry a `buildWidget`; a `component` kind mounts
 * a Svelte component through the injected portal builder; the image widget builder
 * is injected per-render (it holds per-instance state) and registers neither.
 */

import type { Component } from 'svelte';
import type { AnyInlineKind, InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { isLiveHtmlTag, buildLiveHtmlWidget } from './raw-html-widget';

/**
 * Props a `component` widget kind is mounted with. A frozen-at-mount snapshot: the
 * component keeps these values for its whole life. The reuse pool remounts on a
 * source change and re-stamps the wrapper offsets on reuse, so a live instance
 * never sees `source` change under it — it always describes the source it was built
 * for. `inline.start`/`end` are equally frozen and CAN lag once adjacent typing
 * shifts the widget; the live position is the wrapper's re-stamped `data-source-*`
 * attributes, never these fields. Read them; do not treat them as reactive.
 */
export interface InlineWidgetComponentProps {
	inline: InlineNode;
	source: string;
}

/**
 * Per-kind editing behavior for a live inline widget.
 *
 * `deleteGranularity` and `onEdge` are deliberately absent: nothing consumes them,
 * and freezing an inert field is the one change that breaks an author's config
 * later. They re-add additively with the inline-entity consumer that defines them
 * (target shapes in `docs/design/plugin-contract.md`).
 */
export interface InlineWidgetEditingPolicy {
	revealSource?: boolean;
	onSelectedKey?: (e: KeyboardEvent, ctx: InlineWidgetEditingContext) => boolean;
}

/** What a widget kind's key handler is given about the selected widget instance. */
export interface InlineWidgetEditingContext {
	/** Read context — a bytes-readonly view; edits go through `updateContent`. */
	node: NodeView;
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
	 *  per-render (image) or that mount a `component` instead. */
	buildWidget?(node: InlineNode, raw: string): HTMLElement;
	/** Svelte component mounted as the widget body — the recommended path. The
	 *  render layer wraps it in the atomic-island span and mounts it through the
	 *  injected portal builder. Mutually exclusive with `buildWidget`. */
	component?: Component<InlineWidgetComponentProps>;
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
	if (descriptor.component && descriptor.buildWidget) {
		throw new Error(
			`registerInlineWidgetKind: "${kind}" declares both a component and a buildWidget — ` +
				`a widget kind renders through exactly one. Drop one.`
		);
	}
	registry.set(kind, descriptor);
}

/**
 * Layer editing fields onto an already-registered kind's policy. The editor-layer
 * mount wire-up (components/built-in-blocks.ts) uses this to attach behavior — the
 * image resize `onSelectedKey` — that can't live in the core registration without
 * importing a downstream layer. Throws for an unregistered kind.
 */
export function augmentInlineWidgetKind(
	kind: AnyInlineKind,
	editing: Partial<InlineWidgetEditingPolicy>
): void {
	const descriptor = registry.get(kind);
	if (!descriptor) {
		throw new Error(
			`augmentInlineWidgetKind: "${kind}" is not registered — register the widget kind before ` +
				`augmenting its editing policy.`
		);
	}
	descriptor.editing = { ...descriptor.editing, ...editing };
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

/** The Svelte component a kind mounts as its widget body, or undefined for a
 *  core-builder / injected-builder kind. The render layer reads this to route a
 *  component kind through the injected portal builder. */
export function getInlineWidgetComponent(
	kind: AnyInlineKind
): Component<InlineWidgetComponentProps> | undefined {
	return registry.get(kind)?.component;
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

/**
 * Build a live inline widget's DOM from the registry. A `buildWidget` kind builds
 * synchronously here; a `component` kind routes through the injected
 * `buildPortalWidget` (the component layer owns Svelte mounting — `core/` stays
 * framework-free). Returns null when the node is not a widget, its kind builds via
 * an injected per-render builder (image), or the portal builder is absent/failed.
 */
export function buildCoreInlineWidget(
	node: InlineNode,
	raw: string,
	buildPortalWidget?: (node: InlineNode, raw: string) => HTMLElement | null
): HTMLElement | null {
	const descriptor = registry.get(node.kind);
	if (!descriptor || !descriptor.isWidget(node, raw)) return null;
	if (descriptor.component) return buildPortalWidget?.(node, raw) ?? null;
	return descriptor.buildWidget ? descriptor.buildWidget(node, raw) : null;
}

registerInlineWidgetKind('image', {
	isWidget: () => true,
	// Base policy the editor layer augments with `onSelectedKey` — resize keys can't
	// live in a core registration (components/built-in-blocks.ts).
	editing: {}
});

registerInlineWidgetKind('rawHtml', {
	isWidget: (node, raw) => isLiveHtmlTag(raw.slice(node.start, node.end)),
	buildWidget: (node) => buildLiveHtmlWidget(node)
});

// Must stay below the built-in registrations above — it snapshots what the test
// reset is not allowed to drop.
const BUILTIN_INLINE_WIDGET_KINDS: ReadonlySet<AnyInlineKind> = new Set(registry.keys());

/** Test-only. Removes every plugin-registered inline-widget kind; built-ins survive. */
export function __resetInlineWidgetsForTests(): void {
	for (const kind of registry.keys()) {
		if (!BUILTIN_INLINE_WIDGET_KINDS.has(kind)) registry.delete(kind);
	}
}
