/**
 * DOM-building steps for TextEditableBlock's render effect. The component owns the effect
 * and the `pendingCursorOffset` restore, since those writes touch `$state`; this factory
 * builds the inline DOM and keeps a live caret across a rebuild a decoration caused, which
 * the edit path's own restore does not cover.
 */

import type { AmbientPrefix } from '../../../block-component';
import type { DocumentView, NodeView } from '../../../core/node-views';
import { hidesMarkers, type PresentationMode } from '../../../presentation-mode';
import type { ResolveImageUrl, ResolveLinkUrl } from '../../../editor-keys';
import { buildAmbientSpan } from '../../../ambient/ambient-dom';
import {
	computeInlineContent,
	contentLengthOf,
	getContentRange,
	isProseKind
} from '../../../core/inline';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import { renderInlineNodes, type ImageLoadPolicy } from '../../../core/inline-render';
import type { DomTextOffset } from '../../../cursor/coordinate-spaces';
import { CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome } from '../../../cursor/widget-offset';
import {
	captureFocusedCaretWalkOffset,
	restoreCaretAtWalkOffset
} from '../../../cursor/focused-caret';
import type { IndexedDecoration } from '../../../decorations/buckets';
import { applyIslandDecorations, islandRenderKeyPart } from '../../../decorations/island-dom';
import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
import { mountDecorationWidget } from '../../../decorations/widget-dom';
import { devWarn } from '../../../dev-warn';
import { recordIslandRebuild } from '../../../perf/instruments';
import {
	isInteractionTraceEnabled,
	traceRebuild,
	traceCursorCapture,
	traceCursorRestore,
	traceIslandsApplied
} from '../../../debug/interaction-trace';
import { buildImageWidget } from '../../image/widget-dom';
import type { InlineNode } from '../../../core/nodes';
import { getBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
import { createSvelteWidgetPool } from '../widget-portal';

export interface TextRenderDeps {
	get el(): HTMLElement | null;
	get node(): NodeView;
	get ambientPrefix(): AmbientPrefix;
	get ambientPrefixText(): string;
	getDisplayText: () => string;
	resolveImageUrl: ResolveImageUrl;
	resolveLinkUrl: ResolveLinkUrl;
	get imageLoadPolicy(): ImageLoadPolicy;
	/** The mode in effect. Read inside the render pass on purpose: that read is the
	 *  reactive dependency that re-renders every mounted block when the mode changes. */
	get presentationMode(): PresentationMode;
	/** The editor's theme name, passed on to widgets. Not part of the render key: this DOM
	 *  is themed by CSS, so only a widget that draws its own colors reads it. */
	getTheme?: () => string;
	/** Live root document for widgets that derive from it. A getter, so a pooled widget
	 *  re-reads the current document across edits rather than a mount-time snapshot. */
	getDocument: () => DocumentView | undefined;
	/** The editor's content version, so a widget can memoize a document-wide derivation
	 *  on it. Absent in a bare harness. */
	getContentVersion?: () => number;
	/** The editor's navigation call, passed on to widgets whose gesture jumps elsewhere. */
	navigateTo?: (path: number[]) => Promise<boolean>;
	get linkResolver(): LinkReferenceResolver | undefined;
	/** A short token that changes exactly when the document's link-reference definitions do
	 *  (`link-reference-resolver.ts` makes it), so a block holding a reference puts this in
	 *  its render key instead of a signature string that can reach megabytes. */
	get linkStamp(): string;
	/** Decoration widgets, sorted by position. A getter read inside the render pass on
	 *  purpose: that read is the dependency that re-renders the block when one changes. */
	get islands(): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	brokenUrlCache: Set<string>;
	/** A widget that throws while mounting reports to the editor's `error` event. Without
	 *  this it goes unreported, and the widget still falls back to its raw source. */
	reportRenderError?: (error: unknown) => void;
}

export interface TextRender {
	/**
	 * Rebuild the block's children from the node's current state. Skips work on an unchanged
	 * render key unless `forceRebuild`, which a pending cursor restore passes so the DOM is
	 * rebuilt anyway. `carryCaret` re-anchors the caret; the edit path passes false.
	 */
	render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void;
	/** Destroy every pooled widget instance, called when the block unmounts. */
	dispose(): void;
}

// The NUL-joined parts of a prose renderKey, index-aligned.
const RENDER_KEY_SEGMENTS = [
	'ambient',
	'raw',
	'ref',
	'imgPolicy',
	'mode',
	'kind',
	'islands'
] as const;

/** Which parts of the render key differ, which the interaction trace reports as the cause of
 *  a rebuild. Pure over the key format, so the recorder never learns the NUL layout. */
export function renderKeySegmentDiff(prev: string, next: string): string {
	const a = prev.split('\0');
	const b = next.split('\0');
	const changed: string[] = [];
	for (let i = 0; i < RENDER_KEY_SEGMENTS.length; i++) {
		if ((a[i] ?? '') !== (b[i] ?? '')) changed.push(RENDER_KEY_SEGMENTS[i]);
	}
	return changed.join(',') || '(none)';
}

export function createTextRender(deps: TextRenderDeps): TextRender {
	let lastRenderedKey = '';
	const widgetPool = createSvelteWidgetPool({
		reportError: deps.reportRenderError,
		getPresentationMode: () => deps.presentationMode,
		getTheme: deps.getTheme,
		getDocument: deps.getDocument,
		getContentVersion: deps.getContentVersion,
		navigateTo: deps.navigateTo
	});
	let islandDestroys: Array<() => void> = [];

	function destroyIslands(): void {
		for (const destroy of islandDestroys) destroy();
		islandDestroys = [];
	}

	function buildPortalWidget(node: InlineNode, raw: string): HTMLElement | null {
		return widgetPool.acquire(node.kind, node, raw.slice(node.start, node.end));
	}

	// The dimmed marker part of the raw: whatever the kind's descriptor leaves out of
	// the content range. Kinds that declare none give ''.
	function getBlockMarkerPrefix(): string {
		const node = deps.node;
		const range = getContentRange(node);
		return node.raw.slice(0, range.start);
	}

	// The render path computes inline content on the pure path, never the caching
	// accessor: the cache is non-reactive and would skip render-relevant changes (G4.2).
	function buildInlineDOM(content: InlineNode[]): DocumentFragment {
		const node = deps.node;
		const frag = document.createDocumentFragment();
		if (deps.ambientPrefixText) {
			frag.appendChild(buildAmbientSpan(deps.ambientPrefix));
		}
		const blockOwnPrefix = getBlockMarkerPrefix();
		if (blockOwnPrefix) {
			const span = document.createElement('span');
			span.className = 'md-marker';
			span.textContent = blockOwnPrefix;
			frag.appendChild(span);
		}
		const descriptor = getBlockKindDescriptor(node.kind);
		frag.appendChild(
			renderInlineNodes(content, node.raw, {
				renderImagesAsWidgets: descriptor.renderImagesAsWidgets ?? true,
				resolveImageUrl: deps.resolveImageUrl,
				resolveLinkUrl: deps.resolveLinkUrl,
				imageLoadPolicy: deps.imageLoadPolicy,
				buildImageWidget: (imgNode, imgRaw, imgOpts) =>
					buildImageWidget(imgNode, imgRaw, { ...imgOpts, brokenUrlCache: deps.brokenUrlCache }),
				buildPortalWidget,
				// Data attributes only, for the code that shows construct markers; set in this
				// mode alone so the other modes' DOM stays byte-identical.
				tagConstructMarkers: deps.presentationMode === 'preview-inline',
				pendingBreakSeat: hidesMarkers(deps.presentationMode)
			})
		);
		return frag;
	}

	// No inline pass runs here, so the remainder is a verbatim text node.
	function buildMarkerPrefixDOM(marker: string, rest: string): DocumentFragment {
		const frag = document.createDocumentFragment();
		const span = document.createElement('span');
		span.className = 'md-marker';
		span.textContent = marker;
		frag.appendChild(span);
		frag.appendChild(document.createTextNode(rest));
		return frag;
	}

	// A `<br>` inside a decoration widget belongs to that widget, so it cannot serve as the
	// empty block's caret anchor.
	function ensureBr(el: HTMLElement): void {
		if (deps.getDisplayText() !== '') return;
		const hasAnchorBr = [...el.querySelectorAll('br')].some(
			(br) => !br.closest('[data-decoration-island]')
		);
		if (!hasAnchorBr) el.appendChild(document.createElement('br'));
	}

	function captureCaretIfFocused(el: HTMLElement): DomTextOffset | null {
		const walk = captureFocusedCaretWalkOffset(el);
		if (walk !== null) traceCursorCapture(walk);
		return walk;
	}

	function restoreCaret(el: HTMLElement, walkOffset: DomTextOffset): void {
		restoreCaretAtWalkOffset(el, walkOffset);
		traceCursorRestore(walkOffset);
	}

	function render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void {
		const el = deps.el;
		if (!el) return;
		const node = deps.node;
		// Checking for a bracket before reading the signature or the resolver keeps one edit
		// to a link-reference definition from re-rendering the whole document.
		const hasRef = node.raw.includes('[');
		const refKeyPart = hasRef ? deps.linkStamp : '';
		// The built widget bakes in `imageLoadPolicy`, so the key tracks it, but only for
		// blocks with an image, which keeps image-free blocks off that dependency.
		const hasImg = node.raw.includes('![');
		const imgKeyPart = hasImg ? deps.imageLoadPolicy : '';
		// Always included, unlike the reference and image parts: a mode change re-renders
		// every mounted block. '' in source mode keeps the default key byte-identical.
		const mode = deps.presentationMode;
		const modeKeyPart = mode === 'source' ? '' : mode;
		const islands = deps.islands;
		// The kind is a render input, not just a branch selector: two prose kinds can share
		// a raw when the registry gains an opener for bytes already in the document, and
		// the memo would then early-return onto the previous kind's DOM.
		const renderKey = `${deps.ambientPrefixText}\0${node.raw}\0${refKeyPart}\0${imgKeyPart}\0${modeKeyPart}\0${node.kind}${islandRenderKeyPart(islands)}`;
		const forceRebuild = opts?.forceRebuild ?? false;
		const carryCaret = opts?.carryCaret ?? true;
		let carriedCaret: DomTextOffset | null = null;

		if (isProseKind(node.kind)) {
			if (renderKey === lastRenderedKey && !forceRebuild) return;
			// Working out which parts differ allocates, so it stays behind the trace check.
			if (isInteractionTraceEnabled())
				traceRebuild(renderKeySegmentDiff(lastRenderedKey, renderKey), forceRebuild);
			const content = computeInlineContent(node, hasRef ? deps.linkResolver : undefined);
			// Rebuilds from the edit path skip the capture-and-restore pair: the component's
			// pending restore overwrites the selection right after, so it would be wasted.
			const caretWalkOffset = carryCaret ? captureCaretIfFocused(el) : null;
			// Bracketing the rebuild pools portal widgets: the sweep destroys only those the
			// previous DOM held and this build did not reuse. Decoration widgets are not pooled.
			widgetPool.beginPass();
			destroyIslands();
			el.replaceChildren(buildInlineDOM(content));
			islandDestroys = applyIslandDecorations(el, node.raw, islands, {
				contentLength: contentLengthOf(node),
				ambientLength: deps.ambientPrefixText.length,
				mountWidget: (spec, dec) => mountDecorationWidget(spec, dec, deps.reportRenderError),
				onSkipped: (dec, reason) => devWarn('decorations', `island skipped: ${reason}`, dec)
			});
			if (islands.length > 0) {
				recordIslandRebuild();
				traceIslandsApplied(islands.length);
			}
			widgetPool.sweep();
			carriedCaret = caretWalkOffset;
		} else {
			// An empty pass clears any widget stranded by a prose-to-non-prose kind change in
			// place, which reuses this same component instance.
			widgetPool.beginPass();
			destroyIslands();
			widgetPool.sweep();
			const display = deps.getDisplayText();
			const markerPrefix = getBlockMarkerPrefix();
			if (markerPrefix) {
				// The line stays one editable coordinate space, so an edit that breaks the
				// fence reparses to the natural kind.
				if (el.textContent !== display || forceRebuild) {
					el.replaceChildren(
						buildMarkerPrefixDOM(markerPrefix, display.slice(markerPrefix.length))
					);
				}
			} else if (el.textContent !== display) {
				el.textContent = display;
			}
		}

		// Always set: after this pass the DOM matches the render key even where a branch
		// skipped its write, and a key left stale by a skipped write would let a later
		// render early-return onto old DOM.
		lastRenderedKey = renderKey;
		ensureBr(el);
		// This attribute decides which spans the caret can land in, so it is set first.
		el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));
		if (carriedCaret !== null) restoreCaret(el, carriedCaret);
	}

	return {
		render,
		dispose: () => {
			destroyIslands();
			widgetPool.dispose();
		}
	};
}
