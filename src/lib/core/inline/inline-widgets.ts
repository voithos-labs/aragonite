/**
 * The one registry of which inline kinds render as live widgets (non-editable spans marked
 * `[data-inline-widget]`) and how each is recognized. DOM building has three routes: a
 * `buildWidget` for core-built widgets, a `component` mounted through the injected portal
 * builder, or neither for the image, whose builder is injected per render.
 */

import type { Component } from 'svelte';
import { isBuiltinInlineKind, type AnyInlineKind, type InlineNode } from '../nodes';
import type { DocumentView, NodeView } from '../node-views';
import type { PresentationMode } from '../../presentation-mode';
import { isLiveHtmlTag, buildLiveHtmlWidget } from './raw-html-widget';
import { entityRendersGlyph, buildEntityWidget } from './entity-widget';
import { createPluginRegistry } from '../../schema/plugin-registry';
import type { GrammarView } from '../../schema/block-openers';
import { inlineDescendants } from './walk';

/**
 * The widget shell every core builder shares. Its `data-*` attributes are the only handle the
 * DOM-to-offset traversal has, so the shell is created here once and builders add only the body.
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

/** The raw byte range a shell carries, or null when the attributes are absent or malformed:
 *  {@link mintWidgetShell}'s inverse, kept beside it so the two move together. */
export function widgetSourceRange(el: Element): { start: number; end: number } | null {
	const start = parseInt(el.getAttribute('data-source-start') ?? '', 10);
	const end = parseInt(el.getAttribute('data-source-end') ?? '', 10);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return { start, end };
}

/**
 * Props a `component` widget kind is mounted with. Frozen at mount: the pool remounts on a
 * source change, so `source` never shifts under a live instance, but `inline.start`/`end` can
 * lag once typing beside the widget moves it. The live position is the wrapper's rewritten
 * `data-source-*`, never these fields. The getters below are live for the inverse reason: a
 * reused instance would go stale on a frozen value.
 */
export interface InlineWidgetComponentProps {
	inline: InlineNode;
	source: string;
	/** Absent reads as 'source'. */
	getPresentationMode?: () => PresentationMode;
	/** A widget whose body a renderer such as KaTeX draws emits colors no stylesheet reaches, so
	 *  it keys its render on this. One styled with CSS tokens needs nothing. */
	getTheme: () => string;
	/** The pool keys on `${kind} ${source}`, so a widget whose value derives from the document
	 *  (footnote numbering) needs this to survive edits elsewhere that change no source. */
	getDocument?: () => DocumentView | undefined;
	/** Memo key for a whole-document derivation, since the `$state` document mutates in place and
	 *  keeps its identity. Read it inside the widget's `$derived` to re-run on edits anywhere. */
	getContentVersion?: () => number;
	/** `EditorRects.navigateTo`: mount, scroll to and put the caret at a raw offset in a block
	 *  path. Absent in a bare harness, so a widget that navigates declines rather than throws. */
	navigateTo?: (path: number[], offset?: number) => Promise<boolean>;
	/** `EditorContext.computeInlineContent` for the widget's editor: a parse that reads only the
	 *  inline syntax that editor draws. Absent in a bare harness. */
	computeInlineContent?: (node: NodeView) => InlineNode[];
}

/** Shared by the editable element deciding whether to show the source and the widget deciding
 *  whether to act. Reading mode has no caret to place, so a plain click activates, as for links. */
export function isWidgetActivationClick(modified: boolean, mode: PresentationMode): boolean {
	return modified || mode === 'reading';
}

/** The closed vocabularies as values, so the published conformance kit checks a registration
 *  against the type's own members rather than a copy that ages out of step with it. */
export const DELETE_GRANULARITIES = ['atomic', 'select-then-delete'] as const;
export const ON_EDGE_POLICIES = ['select', 'step-over'] as const;

/**
 * Per-kind editing behavior, read by the caret-edge dispatch
 * (`components/blocks/text/edge-policy-dispatch.ts`). `atomic` deletes in one keypress where
 * `select-then-delete` takes two; `onEdge` chooses between selecting the construct whole and
 * stepping over it like a character.
 */
export interface InlineWidgetEditingPolicy {
	revealSource?: boolean;
	/** The editable content's offsets in the source span (`$x$` gives `{ start: 1, end: 2 }`),
	 *  bounding the caret; a click with no mapped point lands at `end`. Absent: the start edge. */
	revealContentSpan?: (source: string) => { start: number; end: number } | null;
	/** The `source` offset under a click, so the caret goes where the user clicked; only the kind
	 *  can map its render (KaTeX glyphs) back to bytes. Null keeps the fallback. */
	revealOffsetAtPoint?: (
		widgetEl: HTMLElement,
		source: string,
		clientX: number,
		clientY: number
	) => number | null;
	deleteGranularity?: (typeof DELETE_GRANULARITIES)[number];
	onEdge?: (typeof ON_EDGE_POLICIES)[number];
	onSelectedKey?: (e: KeyboardEvent, ctx: InlineWidgetEditingContext) => boolean;
	/** The widget's own component handles an activation click ({@link isWidgetActivationClick}),
	 *  so the editable element does not show the source, which would unmount the widget. */
	claimsActivationClick?: boolean;
}

export interface InlineWidgetEditingContext {
	/** Read-only, since an undo entry may share the node (G1.9); edit through `updateContent`. */
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
	 *  the widget shell span and mounts it through the injected portal builder. */
	component?: Component<InlineWidgetComponentProps>;
	editing?: InlineWidgetEditingPolicy;
}

const registry = createPluginRegistry<AnyInlineKind, InlineWidgetDescriptor>({
	label: 'registerInlineWidgetKind',
	isBuiltin: isBuiltinInlineKind
});

/** The kind's descriptor under an editor's grammar: absent where the editor left out the plugin
 *  that registered it, so a node of that kind renders as its source. */
function widgetOf(kind: AnyInlineKind, grammar: GrammarView): InlineWidgetDescriptor | undefined {
	return registry.get(kind, grammar.activation);
}

export function registerInlineWidgetKind(
	kind: AnyInlineKind,
	descriptor: InlineWidgetDescriptor
): void {
	if (descriptor.component && descriptor.buildWidget) {
		throw new Error(
			`registerInlineWidgetKind: "${kind}" declares both a component and a buildWidget; ` +
				`a widget kind renders through exactly one. Drop one.`
		);
	}
	registry.register(
		kind,
		descriptor,
		`registerInlineWidgetKind: "${kind}" is already registered. Inline-widget kinds are ` +
			`register-once — a re-registration would clobber a built-in (image/rawHtml).`
	);
}

/** Lets the editor layer (`components/built-in-blocks.ts`) attach editing behavior without a core
 *  registration importing it. Throws for an unregistered kind. */
export function augmentInlineWidgetKind(
	kind: AnyInlineKind,
	editing: Partial<InlineWidgetEditingPolicy>
): void {
	const descriptor = registry.getIgnoringActivation(kind);
	if (!descriptor) {
		throw new Error(
			`augmentInlineWidgetKind: "${kind}" is not registered; register the widget kind before ` +
				`augmenting its editing policy.`
		);
	}
	descriptor.editing = { ...descriptor.editing, ...editing };
}

// Each lookup below takes the editor's grammar, which leaves out the plugins it did not list.

/** Whether the kind renders as a widget under the editor's grammar, whatever one node's bytes. */
export function isInlineWidgetKind(kind: AnyInlineKind, grammar: GrammarView): boolean {
	return widgetOf(kind, grammar) !== undefined;
}

/** Kind-level recognition, independent of per-block render policy (renderImagesAsWidgets). */
export function isInlineWidget(node: InlineNode, raw: string, grammar: GrammarView): boolean {
	const descriptor = widgetOf(node.kind, grammar);
	return descriptor ? descriptor.isWidget(node, raw) : false;
}

export function getInlineWidgetEditing(
	kind: AnyInlineKind,
	grammar: GrammarView
): InlineWidgetEditingPolicy | undefined {
	return widgetOf(kind, grammar)?.editing;
}

/** A kind the caret treats as one character: it steps over in one keypress, has a column of its
 *  own, and a click on its glyph names an edge rather than selecting the widget whole. */
export function isCharacterLikeWidget(kind: AnyInlineKind, grammar: GrammarView): boolean {
	return getInlineWidgetEditing(kind, grammar)?.onEdge === 'step-over';
}

export function getInlineWidgetComponent(
	kind: AnyInlineKind,
	grammar: GrammarView
): Component<InlineWidgetComponentProps> | undefined {
	return widgetOf(kind, grammar)?.component;
}

/** Descends into non-widget parents (the `image` inside `[![alt][ref]][repo]`) but never into a
 *  widget, whose children are atomic. `raw` is the enclosing block's source. */
export function flattenInlineWidgets(
	nodes: ReadonlyArray<InlineNode>,
	raw: string,
	grammar: GrammarView
): InlineNode[] {
	const out: InlineNode[] = [];
	const isWidget = (node: InlineNode) => isInlineWidget(node, raw, grammar);
	for (const node of inlineDescendants(nodes, (parent) => !isWidget(parent))) {
		if (isWidget(node)) out.push(node);
	}
	return out;
}

/** A `component` kind mounts through the injected `buildPortalWidget`, keeping `core/` free of
 *  Svelte. Null for a non-widget, an image (built per render), or a missing or failed portal. */
export function buildCoreInlineWidget(
	node: InlineNode,
	raw: string,
	buildPortalWidget: ((node: InlineNode, raw: string) => HTMLElement | null) | undefined,
	grammar: GrammarView
): HTMLElement | null {
	const descriptor = widgetOf(node.kind, grammar);
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

// Only an entity that draws a glyph becomes a widget: an invisible one keeps its literal-source
// span, or the caret would step over something it cannot see.
registerInlineWidgetKind('entityReference', {
	isWidget: (node) => entityRendersGlyph(node.decoded),
	buildWidget: (node) => buildEntityWidget(node),
	editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
});
