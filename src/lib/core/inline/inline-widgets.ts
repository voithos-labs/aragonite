/**
 * The one registry of which inline kinds render as live widgets (non-editable spans marked
 * `[data-inline-widget]`) and how each is recognized. A plugin's kind draws through its `view`,
 * mounted in a shell the render layer makes; the editor's own kinds draw here, and the image is
 * built per render.
 */

import { isBuiltinInlineKind, type AnyInlineKind, type InlineNode } from '../nodes';
import type { DocumentView, NodeView } from '../node-views';
import type { PresentationMode } from '../../presentation-mode';
import type { ActivationClick, ClickInput } from '../../activation-click';
import { isLiveHtmlTag, buildLiveHtmlWidget } from './raw-html-widget';
import { entityRendersGlyph, buildEntityWidget } from './entity-widget';
import { createInlineKindRegistry } from '../../schema/plugin-kind';
import { registerAsCore } from '../../schema/plugin-install';
import type { GrammarView } from '../../schema/block-openers';
import { inlineDescendants } from './walk';
import type { PluginView } from '../../plugin-view';

/** The inline-widget element whose source starts at `start`, or null. The only place this
 *  selector is written: a mistyped copy would fail silently as a null `querySelector`. */
export function widgetElByStart(el: HTMLElement, start: number): HTMLElement | null {
	return el.querySelector<HTMLElement>(`[data-inline-widget][data-source-start="${start}"]`);
}

/** The tab stop of the widget in `el` whose source ends at `offset`: what a reading-mode landing
 *  at `offset` focuses, so a jump back to a reference lands on the reference. */
export function widgetTabStopEndingAt(el: HTMLElement, offset: number): HTMLElement | null {
	const widget = el.querySelector(`[data-inline-widget][data-source-end="${offset}"]`);
	if (!widget) return null;
	return (
		[widget, ...widget.querySelectorAll('*')].find(
			(node): node is HTMLElement => node instanceof HTMLElement && node.tabIndex >= 0
		) ?? null
	);
}

/**
 * Props an inline widget's view gets. The editor mounts a new view when the widget's source
 * changes, so `source` never shifts under one, and sends `update` with the new `inline` when typing
 * beside the widget moves it. The getters stay live between updates, since the mode, theme and
 * document change without touching the widget.
 */
export interface InlineWidgetComponentProps {
	inline: InlineNode;
	source: string;
	getPresentationMode: () => PresentationMode;
	/** A widget whose body a renderer such as KaTeX draws emits colors no stylesheet reaches, so
	 *  it keys its render on this. One styled with CSS tokens needs nothing. */
	getTheme: () => string;
	/** The pool keys on `${kind} ${source}`, so a widget whose value derives from the document
	 *  (footnote numbering) needs this to survive edits elsewhere that change no source. */
	getDocument: () => DocumentView | undefined;
	/** Memo key for a whole-document derivation, since the `$state` document mutates in place and
	 *  keeps its identity. Read it inside the widget's `$derived` to re-run on edits anywhere. */
	getContentVersion: () => number;
	/** `EditorRects.navigateTo`: mount, scroll to and put the caret at a raw offset in a block
	 *  path. Resolves false where it can't land, so a widget never needs a fallback. */
	navigateTo: (path: number[], offset?: number) => Promise<boolean>;
	/** `EditorContext.computeInlineContent` for the widget's editor: it parses as that editor draws,
	 *  and it's a new function whenever the document's definitions change. */
	computeInlineContent: (node: NodeView) => InlineNode[];
	/** Whether a click is this widget's to act on: false unless the kind claims the activation
	 *  click, then the host's gesture in the mode in force. The editor shows no source for these. */
	isActivationClick: (click: ClickInput) => boolean;
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
	/** Show the widget's source for editing when the caret enters it, or when an edit leaves the
	 *  caret inside it (a `#` typed before `tag`). Without it, such a caret lands past the widget. */
	revealSource?: boolean;
	/** Where the caret may sit in the source (`$x$` gives `{ start: 1, end: 2 }`); a click with no
	 *  mapped point lands at `end`. Absent: anywhere in it, and such a click lands at the start. */
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
	/** A key pressed while the widget is selected whole: true takes it, and the editor prevents its
	 *  default. Text a soft keyboard sends with no key replaces the widget without reaching it. */
	onSelectedKey?: (e: KeyboardEvent, ctx: InlineWidgetEditingContext) => boolean;
	/** The widget goes somewhere on a click, as a link does, so the click the host picked for
	 *  links is its component's to act on and shows no source, which would unmount the widget. */
	claimsActivationClick?: boolean;
}

/** Whether a widget goes somewhere on a click: what following it and Edit link both read. */
export function claimsActivationClick(policy: InlineWidgetEditingPolicy | undefined): boolean {
	return policy?.claimsActivationClick === true;
}

/** The one answer both sides of a click on a widget read: the editable element leaves the source
 *  hidden for it, and the widget's component (its `isActivationClick` prop) acts on it. */
export function widgetActivates(
	policy: InlineWidgetEditingPolicy | undefined,
	click: ClickInput,
	activationClick: ActivationClick
): boolean {
	return claimsActivationClick(policy) && activationClick(click);
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
	/** Draws the widget into the shell the editor makes for it, the element that carries its bytes. */
	view: PluginView<InlineWidgetComponentProps>;
	editing?: InlineWidgetEditingPolicy;
	/** The widget stands in its line as a picture does, its box taller than the text beside it;
	 *  a caret beside it draws at that text's height. */
	frame?: boolean;
}

/** The editor's own kinds draw without a view: a builder here, or none for the image, which the
 *  render builds per block. */
interface WidgetEntry extends Omit<InlineWidgetDescriptor, 'view'> {
	view?: InlineWidgetDescriptor['view'];
	draw?(node: InlineNode, raw: string): HTMLElement;
}

const registry = createInlineKindRegistry<WidgetEntry>({
	label: 'registerInlineWidgetKind',
	isBuiltin: isBuiltinInlineKind
});

/** The kind's descriptor under an editor's grammar: absent where the editor left out the plugin
 *  the entry answers to, so a node of that kind renders as its source. */
function widgetOf(kind: AnyInlineKind, grammar: GrammarView): WidgetEntry | undefined {
	return registry.get(kind, grammar.activation);
}

/** The message a plugin gets when it passes a drawing field where a `view` belongs. */
export const UPGRADE_HINT =
	'buildWidget, buildDom and component became `view`; svelteView wraps a Svelte component';

export function registerInlineWidgetKind(
	kind: AnyInlineKind,
	descriptor: InlineWidgetDescriptor
): void {
	if (typeof descriptor.view !== 'function') {
		throw new TypeError(`registerInlineWidgetKind: "${kind}" needs a \`view\` (${UPGRADE_HINT})`);
	}
	// Only the published fields, so a stray `draw` on the object can't skip the view's wrapper.
	registerWidgetEntry(kind, {
		isWidget: (node, raw) => descriptor.isWidget(node, raw),
		view: descriptor.view,
		editing: descriptor.editing,
		frame: descriptor.frame
	});
}

/** For a kind the editor draws itself (`core/directive/kinds.ts`), never a plugin's. */
export function registerCoreInlineWidget(kind: AnyInlineKind, entry: WidgetEntry): void {
	registerAsCore(() => registerWidgetEntry(kind, entry));
}

function registerWidgetEntry(kind: AnyInlineKind, descriptor: WidgetEntry): void {
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
	return descriptor ? matchesWidget(descriptor, node, raw) : false;
}

/** A plugin's `isWidget` that throws reads as false, so the render shows the construct as its
 *  source and the caret walks it as text; only the render has a reporter to hand it. */
function matchesWidget(
	descriptor: WidgetEntry,
	node: InlineNode,
	raw: string,
	reportWidgetError?: (error: unknown) => void
): boolean {
	try {
		return descriptor.isWidget(node, raw);
	} catch (error) {
		reportWidgetError?.(error);
		return false;
	}
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

/** Whether the kind's widget stands in its line as a picture does (its descriptor's `frame`). */
export function isFrameWidget(kind: AnyInlineKind, grammar: GrammarView): boolean {
	return widgetOf(kind, grammar)?.frame === true;
}

export function getInlineWidgetView(
	kind: AnyInlineKind,
	grammar: GrammarView
): InlineWidgetDescriptor['view'] | undefined {
	return widgetOf(kind, grammar)?.view;
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

/** The inline nodes a block draws, in order: where `opensConstructs`, a construct with hidden
 *  markers draws only its content, so its children stand in for it. A widget is drawn whole. */
export function drawnInlines(
	nodes: ReadonlyArray<InlineNode>,
	raw: string,
	grammar: GrammarView,
	opensConstructs: boolean
): InlineNode[] {
	const out: InlineNode[] = [];
	const pending = [...nodes].reverse();
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (opensConstructs && node.children && !isInlineWidget(node, raw, grammar)) {
			for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
		} else {
			out.push(node);
		}
	}
	return out;
}

export interface WidgetBuildOptions {
	/** The shell holding a plugin kind's mounted view, from the block's widget pool. Absent (a render
	 *  nobody sees, which only measures) or null draws the widget as its raw source. */
	acquireViewWidget?: (node: InlineNode, raw: string) => HTMLElement | null;
	/** Where an `isWidget` throw goes; absent for a render nobody sees. */
	reportWidgetError?: (error: unknown) => void;
	/** The editor's grammar: a widget kind whose plugin it leaves out renders as its source. */
	grammar: GrammarView;
}

/** Null for a non-widget, an image (built per render), or a plugin kind with no view to show. */
export function buildCoreInlineWidget(
	node: InlineNode,
	raw: string,
	opts: WidgetBuildOptions
): HTMLElement | null {
	const entry = widgetOf(node.kind, opts.grammar);
	if (!entry || !matchesWidget(entry, node, raw, opts.reportWidgetError)) return null;
	if (entry.draw) return entry.draw(node, raw);
	return entry.view ? (opts.acquireViewWidget?.(node, raw) ?? null) : null;
}

registerCoreInlineWidget('image', {
	isWidget: () => true,
	frame: true,
	// Empty because the image's edge behavior is the dispatch's default; the editor layer
	// augments this with the resize `onSelectedKey` (components/built-in-blocks.ts).
	editing: {}
});

registerCoreInlineWidget('rawHtml', {
	isWidget: (node, raw) => isLiveHtmlTag(raw.slice(node.start, node.end)),
	draw: (node) => buildLiveHtmlWidget(node)
});

// Only an entity that draws a glyph becomes a widget: an invisible one keeps its literal-source
// span, or the caret would step over something it cannot see.
registerCoreInlineWidget('entityReference', {
	isWidget: (node) => entityRendersGlyph(node.decoded),
	draw: (node) => buildEntityWidget(node),
	editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
});
