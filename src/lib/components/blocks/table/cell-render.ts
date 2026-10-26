/**
 * DOM-building for TableCellBlock's render effect. The same as text-render.ts without a
 * marker prefix or block marker, since a cell's whole raw is content, so every decoration
 * offset is a raw offset. The component owns the effect and the pending-cursor restore;
 * this factory builds the DOM.
 */

import type { ActivationClick } from '../../../activation-click';
import type { InlineNode } from '../../../core/nodes';
import type { DocumentView, NodeView } from '../../../core/node-views';
import type { ResolveLinkUrl } from '../../../host-hooks';
import { computeInlineContent, contentLengthOf } from '../../../core/inline';
import { renderInlineNodes } from '../../../core/inline-render';
import { trimTrailingLineEnding } from '../../../core/lines';
import { captureFocusedCaret } from '../../../browser/selection-read';
import { CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome } from '../../../browser/painted';
import type { CaretWriter } from '../../../browser/caret-writer';
import type { RawRange } from '../../../browser/offsets';
import { washShownSource } from '../text/source-wash';
import { widgetsAmong } from '../text/widget-adjacency';
import type { IndexedDecoration } from '../../../decorations/buckets';
import {
	applyIslandDecorations,
	islandRenderKeyPart,
	NO_ISLAND_VIEWS
} from '../../../decorations/island-dom';
import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
import { mountDecorationWidget } from '../../../decorations/widget-dom';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { getBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
import { createViewWidgetPool } from '../widget-portal';
import type { Reading } from '../../../schema/reading';

export interface CellRenderDeps {
	get el(): HTMLElement | null;
	get node(): NodeView;
	/** How the editor reads its bytes. Its mode is read inside the render pass on purpose: that read
	 *  is the reactive dependency that re-renders every mounted cell when the mode changes. */
	get reading(): Reading;
	resolveLinkUrl: ResolveLinkUrl;
	/** The editor's theme name, passed on to widgets. Not part of the render key: this DOM
	 *  is themed by CSS, so only a widget that draws its own colors reads it. */
	getTheme: () => string;
	/** Live root document for widgets that derive from it. A getter, so a pooled widget
	 *  re-reads the current document across edits rather than a mount-time snapshot. */
	getDocument: () => DocumentView | undefined;
	/** The editor's content version, so a widget can memoize a document-wide derivation on it. */
	getContentVersion: () => number;
	/** The editor's navigation call, passed on to widgets whose gesture jumps elsewhere. */
	navigateTo: (path: number[]) => Promise<boolean>;
	/** Whether a click follows what it lands on, passed on to widgets that go somewhere. */
	activationClick: ActivationClick;
	/** Decoration widgets, sorted by position. A getter read inside the render pass on
	 *  purpose: that read is the dependency that re-renders the cell when one changes. */
	get islands(): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	/** A widget that throws while mounting reports to the editor's `error` event, and still falls
	 *  back to its raw source. */
	reportRenderError: (error: unknown) => void;
	/** The editor's caret writer, which puts a carried caret back after a rebuild. A carried caret
	 *  predates the edit that caused the rebuild, so it opens no widget's source. */
	caretWriter: CaretWriter;
	/** The range drawn as a widget's shown source, read in the render pass so opening or closing
	 *  it re-renders the cell. */
	shownSource: () => RawRange | null;
}

export interface CellRender {
	/** Rebuilds the cell's children, skipping an unchanged key unless `forceRebuild`, which a
	 *  pending cursor restore passes. */
	render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void;
	/** The inline widgets the last render drew, read without the inline cache. */
	renderedWidgets(): InlineNode[];
	/** Destroy every pooled widget and mounted decoration, called when the cell unmounts. */
	dispose(): void;
}

export function createCellRender(deps: CellRenderDeps): CellRender {
	let lastRenderedKey = '';
	// Flattened on first read, since an ordinary keystroke's render never asks.
	let rendered: { content: InlineNode[]; raw: string } | null = null;
	let widgets: InlineNode[] | null = null;
	const widgetPool = createViewWidgetPool({
		reportError: deps.reportRenderError,
		getTheme: deps.getTheme,
		getDocument: deps.getDocument,
		getContentVersion: deps.getContentVersion,
		navigateTo: deps.navigateTo,
		reading: deps.reading,
		activationClick: deps.activationClick
	});
	let islandViews = NO_ISLAND_VIEWS;

	function destroyIslands(): void {
		islandViews.destroy();
		islandViews = NO_ISLAND_VIEWS;
	}

	function acquireViewWidget(node: InlineNode, raw: string): HTMLElement | null {
		return widgetPool.acquire(node.kind, node, raw.slice(node.start, node.end));
	}

	function render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void {
		const el = deps.el;
		if (!el) return;
		const node = deps.node;

		// Checking for a bracket before reading the signature or the resolver keeps one edit to
		// a link-reference definition from re-rendering every cell. A false hit reparses the same.
		const hasRef = node.raw.includes('[');
		// Key on the short signature token, never the string, which can reach megabytes.
		const sig = hasRef ? String(deps.reading.resolverEpoch) : '';
		// Always included, unlike the reference part: a mode change re-renders every mounted
		// cell. '' in source mode keeps the default key byte-identical, as text-render does.
		const mode = deps.reading.mode();
		const modeKeyPart = mode === 'source' ? '' : mode;
		const islands = deps.islands;
		const shown = deps.shownSource();
		const shownKeyPart = shown ? `${shown.start}-${shown.end}` : '';
		const renderKey = `${node.raw}\0${sig}\0${modeKeyPart}\0${shownKeyPart}${islandRenderKeyPart(islands)}`;
		const forceRebuild = opts?.forceRebuild ?? false;
		if (renderKey === lastRenderedKey && !forceRebuild) {
			islandViews.update(islands);
			return;
		}

		const content = computeInlineContent(
			node,
			hasRef ? deps.reading.resolver : undefined,
			deps.reading.grammar
		);
		// A decoration change rebuilds a focused cell with no restore pending, so the caret is
		// carried across; an edit opts out because its own restore runs after.
		const caret = (opts?.carryCaret ?? true) ? captureFocusedCaret(el) : null;
		// Bracketing the rebuild pools plugin widgets, so an unchanged `$…$` keeps its
		// instance across per-keystroke rebuilds. Decoration widgets are not pooled.
		widgetPool.beginPass();
		destroyIslands();
		el.replaceChildren(
			renderInlineNodes(content, node.raw, {
				renderImagesAsWidgets: getBlockKindDescriptor(node.kind).renderImagesAsWidgets ?? true,
				resolveLinkUrl: deps.resolveLinkUrl,
				acquireViewWidget,
				reportWidgetError: deps.reportRenderError,
				grammar: deps.reading.grammar,
				// Live mode only: a cell has no per-construct reveal, so in preview-inline its markers
				// show with the cell's focus, which only an untagged marker does (`browser/painted.ts`).
				tagConstructMarkers: deps.reading.mode() === 'live',
				shownSource: shown ?? undefined,
				retainViewWidget: (widget, raw) =>
					widgetPool.retain(widget.kind, raw.slice(widget.start, widget.end))
			})
		);
		washShownSource(el, shown);
		rendered = { content, raw: node.raw };
		widgets = null;
		islandViews = applyIslandDecorations(el, node.raw, islands, {
			contentLength: contentLengthOf(node),
			mountWidget: (spec, dec, target) =>
				mountDecorationWidget(spec, dec, target, deps.reportRenderError),
			onSkipped: (dec, reason) => devWarn('decorations', `decoration skipped: ${reason}`, dec)
		});
		widgetPool.sweep();
		lastRenderedKey = renderKey;

		// An empty cell needs a `<br>` for the caret to anchor in, but a `<br>` inside a
		// decoration widget belongs to that widget, not the cell, so it cannot serve.
		if (trimTrailingLineEnding(node.raw) === '') {
			const hasAnchorBr = [...el.querySelectorAll('br')].some(
				(br) => !br.closest('[data-decoration-island]')
			);
			if (!hasAnchorBr) el.appendChild(document.createElement('br'));
		}

		// A cell whose whole content is an empty construct (`[](u)`) would otherwise draw
		// nothing; the attribute is set before the restore, which uses the same traversal.
		el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));

		if (caret !== null) deps.caretWriter.placeCaretAtRaw(el, caret, { clamp: 'exact' });
	}

	return {
		render,
		renderedWidgets: () =>
			(widgets ??= rendered
				? widgetsAmong(rendered.content, rendered.raw, deps.reading.grammar)
				: []),
		dispose: () => {
			destroyIslands();
			widgetPool.dispose();
		}
	};
}
