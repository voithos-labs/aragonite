/**
 * The single source of truth for which inline kinds render as live atomic widgets
 * (contenteditable=false islands marked `[data-inline-widget]`) and how each is recognized.
 * Recognition is registry-owned; DOM building dispatches by layer: a `buildWidget` for
 * core-built widgets, a `component` mounted through the injected portal builder, or neither
 * for the image, whose per-instance builder is injected per render.
 */

import type { Component } from 'svelte';
import type { AnyInlineKind, InlineNode } from '../nodes';
import type { DocumentView, NodeView } from '../node-views';
import type { PresentationMode } from '../../presentation-mode';
import { isLiveHtmlTag, buildLiveHtmlWidget } from './raw-html-widget';
import { entityRendersGlyph, buildEntityWidget } from './entity-widget';
import { registerOnce } from '../../schema/register-once';
import { inlineDescendants } from './walk';

/**
 * The atomic-widget shell every core builder shares. Its `data-*` attributes are the offset
 * walk's only handle, so the shell is minted here once and builders add only the body.
 */
export function mintWidgetShell(className: string, node: InlineNode): HTMLSpanElement {
	const shell = document.createElement('span');
	shell.className = className;
	shell.dataset.inlineWidget = '';
	shell.dataset.sourceStart = String(node.start);
	shell.dataset.sourceEnd = String(node.end);
	shell.setAttribute('contenteditable', 'false');
	return shell;
}

/** The raw byte range a shell carries, or null when the attributes are absent or malformed —
 *  {@link mintWidgetShell}'s inverse, so the mint and every read-back move together. */
export function widgetSourceRange(el: Element): { start: number; end: number } | null {
	const start = parseInt(el.getAttribute('data-source-start') ?? '', 10);
	const end = parseInt(el.getAttribute('data-source-end') ?? '', 10);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return { start, end };
}

/**
 * Props a `component` widget kind is mounted with. Frozen at mount: the pool remounts on a
 * source change, so `source` never shifts under a live instance, but `inline.start`/`end` CAN
 * lag once adjacent typing moves the widget. The live position is the wrapper's re-stamped
 * `data-source-*`, never these fields. The getters below are live for the same reason inverted:
 * an instance the pool reuses would go stale on a frozen value.
 */
export interface InlineWidgetComponentProps {
	inline: InlineNode;
	source: string;
	/** Absent reads as 'source'. */
	getPresentationMode?: () => PresentationMode;
	/** A widget whose body an ENGINE paints emits colors no stylesheet reaches, so it keys its
	 *  render on this. One styled with CSS tokens needs nothing here. Absent reads as 'dark'. */
	getTheme?: () => string;
	/** The pool keys on `${kind} ${source}`, so a widget whose value derives from the document
	 *  (footnote numbering) needs this to survive edits elsewhere that change no source. */
	getDocument?: () => DocumentView | undefined;
	/**
	 * Memo key for a whole-document derivation: the `$state` document is mutated in place, so
	 * its identity never changes and an identity-keyed memo would hit forever on stale data.
	 * Read it INSIDE the widget's `$derived`; that read is what subscribes it to edits anywhere.
	 */
	getContentVersion?: () => number;
}

/** The closed vocabularies as values, so the published conformance kit checks a registration
 *  against the type's own members rather than a copy that ages out of step with it. */
export const DELETE_GRANULARITIES = ['atomic', 'select-then-delete'] as const;
export const ON_EDGE_POLICIES = ['select', 'step-over'] as const;

/**
 * Per-kind editing behavior, read by the caret-edge dispatch
 * (`components/blocks/text/edge-policy-dispatch.ts`). `atomic` deletes in one press where
 * `select-then-delete` takes two; `onEdge` chooses between selecting the construct whole and
 * stepping over it like a character.
 */
export interface InlineWidgetEditingPolicy {
	revealSource?: boolean;
	deleteGranularity?: (typeof DELETE_GRANULARITIES)[number];
	onEdge?: (typeof ON_EDGE_POLICIES)[number];
	onSelectedKey?: (e: KeyboardEvent, ctx: InlineWidgetEditingContext) => boolean;
}

export interface InlineWidgetEditingContext {
	/** Bytes-readonly (G1.9); edits go through `updateContent`. */
	node: NodeView;
	inline: InlineNode;
	widgetStart: number;
	widgetEnd: number;
	index: number;
	preSelectOffset: number;
	editorContentWidth: number;
	/** Effective mode at dispatch; a handler declines edits in 'reading'. */
	presentationMode: PresentationMode;
	/** Bound by the caller: core cannot reach the editor-actions block API. */
	updateContent: (newRaw: string, caretBefore: number, caretAfter: number) => void;
}

export interface InlineWidgetDescriptor {
	isWidget(node: InlineNode, raw: string): boolean;
	/** Omitted for a kind whose builder is injected per render (image) or that uses `component`. */
	buildWidget?(node: InlineNode, raw: string): HTMLElement;
	/** The recommended path, mutually exclusive with `buildWidget`: the render layer wraps it in
	 *  the atomic-island span and mounts it through the injected portal builder. */
	component?: Component<InlineWidgetComponentProps>;
	editing?: InlineWidgetEditingPolicy;
}

const registry = new Map<AnyInlineKind, InlineWidgetDescriptor>();

export function registerInlineWidgetKind(
	kind: AnyInlineKind,
	descriptor: InlineWidgetDescriptor
): void {
	if (descriptor.component && descriptor.buildWidget) {
		throw new Error(
			`registerInlineWidgetKind: "${kind}" declares both a component and a buildWidget — ` +
				`a widget kind renders through exactly one. Drop one.`
		);
	}
	registerOnce(
		registry.has(kind),
		() => registry.set(kind, descriptor),
		`registerInlineWidgetKind: "${kind}" is already registered. Inline-widget kinds are ` +
			`register-once — a re-registration would clobber a built-in (image/rawHtml).`
	);
}

/**
 * Layer editing fields onto an already-registered kind. The editor-layer wire-up
 * (components/built-in-blocks.ts) attaches behavior here that would otherwise make a core
 * registration import a downstream layer. Throws for an unregistered kind.
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

/** Kind-level recognition, independent of per-block render policy (renderImagesAsWidgets). */
export function isInlineWidget(node: InlineNode, raw: string): boolean {
	const descriptor = registry.get(node.kind);
	return descriptor ? descriptor.isWidget(node, raw) : false;
}

export function getInlineWidgetEditing(kind: AnyInlineKind): InlineWidgetEditingPolicy | undefined {
	return registry.get(kind)?.editing;
}

export function getInlineWidgetComponent(
	kind: AnyInlineKind
): Component<InlineWidgetComponentProps> | undefined {
	return registry.get(kind)?.component;
}

/**
 * Every live widget reachable from `nodes`, in document order. Descends so a widget nested in a
 * non-widget parent is found (the `image` inside `[![alt][ref]][repo]`), but never into a
 * widget's own children, which are atomic. `raw` is the enclosing block's source.
 */
export function flattenInlineWidgets(nodes: ReadonlyArray<InlineNode>, raw: string): InlineNode[] {
	const out: InlineNode[] = [];
	for (const node of inlineDescendants(nodes, (parent) => !isInlineWidget(parent, raw))) {
		if (isInlineWidget(node, raw)) out.push(node);
	}
	return out;
}

/**
 * A `component` kind routes through the injected `buildPortalWidget` because the component layer
 * owns Svelte mounting and `core/` stays framework-free. Null when the node is not a widget, its
 * builder is injected per render (image), or the portal builder is absent or failed.
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
	// Empty because the image's edge behavior is the dispatch's default; the editor layer
	// augments this with the resize `onSelectedKey` (components/built-in-blocks.ts).
	editing: {}
});

registerInlineWidgetKind('rawHtml', {
	isWidget: (node, raw) => isLiveHtmlTag(raw.slice(node.start, node.end)),
	buildWidget: (node) => buildLiveHtmlWidget(node)
});

// Gated to visibly-rendering glyphs: an invisible entity keeps its literal-source span rather
// than becoming an atomic island the caret cannot see.
registerInlineWidgetKind('entityReference', {
	isWidget: (node) => entityRendersGlyph(node.decoded),
	buildWidget: (node) => buildEntityWidget(node),
	editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
});

// Must stay below the built-in registrations: it snapshots what the test reset may not drop.
const BUILTIN_INLINE_WIDGET_KINDS: ReadonlySet<AnyInlineKind> = new Set(registry.keys());

/** Test-only. Removes every plugin-registered inline-widget kind; built-ins survive. */
export function __resetInlineWidgetsForTests(): void {
	for (const kind of registry.keys()) {
		if (!BUILTIN_INLINE_WIDGET_KINDS.has(kind)) registry.delete(kind);
	}
}
