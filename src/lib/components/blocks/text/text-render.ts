/**
 * DOM-build steps for TextEditableBlock's render $effect. The component
 * owns the effect (Svelte reactivity entry point); this factory owns the
 * imperative inline-DOM construction it dispatches to.
 *
 * The `pendingCursorOffset` restore stays in the SFC — those writes touch
 * $state. This factory only carries a live caret across a decoration-driven
 * rebuild (no edit-path pending offset); the edit path passes `carryCaret:
 * false`, since the SFC's pending restore overwrites the selection right after.
 */

import type { AmbientPrefix } from '../../../block-component';
import type { DocumentView, NodeView } from '../../../core/node-views';
import type { PresentationMode } from '../../../presentation-mode';
import type { ResolveImageUrl, ResolveLinkUrl } from '../../../editor-keys';
import { buildAmbientSpan } from '../../../ambient/ambient-dom';
import { computeInlineContent, getContentRange, isProseKind } from '../../../core/inline';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import { renderInlineNodes, type ImageLoadPolicy } from '../../../core/inline-render';
import type { DomTextOffset } from '../../../cursor/coordinate-spaces';
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
	/** Effective mode. Read inside the render pass on purpose: the read is the
	 *  reactive dependency that re-renders every mounted block on a mode flip. */
	get presentationMode(): PresentationMode;
	/** Live root document, handed to component widgets whose derived value depends
	 *  on it (footnote numbering). A getter so a pooled widget re-reads the current
	 *  document across edits, never a mount-time snapshot. */
	getDocument: () => DocumentView | undefined;
	get linkResolver(): LinkReferenceResolver | undefined;
	/** A compact stamp that changes exactly when the document's LRD signature
	 *  changes (the shell mints it — link-reference-resolver.ts). Reference-bearing
	 *  blocks fold this into their render key instead of the whole signature string,
	 *  which reaches ~MB scale in reference-heavy documents. */
	get linkStamp(): string;
	/** Position-sorted islands for this block. A getter, and read inside the
	 *  render pass on purpose: that read is the reactive dependency that
	 *  re-renders the block when its island set changes. */
	get islands(): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[];
	brokenUrlCache: Set<string>;
	/** A widget component's synchronous mount throw is routed here — the editor's
	 *  `error` channel, matching BlockHost's render-boundary origin. Absent → errors
	 *  are not surfaced (the widget still falls back to its raw source). */
	reportRenderError?: (error: unknown) => void;
}

export interface TextRender {
	/**
	 * Rebuild the block's children from current node state. Skips work when
	 * neither (ambientPrefixText, raw, ref-stamp, image-policy, island-signature)
	 * nor `forceRebuild` demands it. Pass `forceRebuild` when a pending cursor
	 * restoration needs the DOM positions re-anchored even though the rendered key
	 * is unchanged. `carryCaret` (default true) captures and re-anchors the focused
	 * caret across the rebuild; pass false on the edit path, where the SFC's
	 * pending-cursor restore overwrites the selection immediately after.
	 */
	render(opts?: { forceRebuild?: boolean; carryCaret?: boolean }): void;
	/** Destroy every pooled widget instance — called when the block unmounts. */
	dispose(): void;
}

// The NUL-joined parts of a prose renderKey, index-aligned. `islands` is the
// trailing segment islandRenderKeyPart contributes (absent ⇒ no sixth part).
const RENDER_KEY_SEGMENTS = ['ambient', 'raw', 'ref', 'imgPolicy', 'mode', 'islands'] as const;

/** Which renderKey segment(s) differ between two keys — the interaction trace's
 *  rebuild cause. Pure over the key format so the recorder never learns the NUL
 *  layout and the decomposition is directly testable. */
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
	const widgetPool = createSvelteWidgetPool(
		deps.reportRenderError,
		() => deps.presentationMode,
		deps.getDocument
	);
	let islandDestroys: Array<() => void> = [];

	function destroyIslands(): void {
		for (const destroy of islandDestroys) destroy();
		islandDestroys = [];
	}

	function buildPortalWidget(node: InlineNode, raw: string): HTMLElement | null {
		return widgetPool.acquire(node.kind, node, raw.slice(node.start, node.end));
	}

	// The dimmed marker portion of the raw (a heading's `## `, a directive leaf's
	// `::name`) — whatever the kind's descriptor excludes from the content range.
	// Kinds that declare none yield '' and render as plain text.
	function getBlockMarkerPrefix(): string {
		const node = deps.node;
		const range = getContentRange(node);
		return node.raw.slice(0, range.start);
	}

	// Render computes inline content via computeInlineContent (the pure path), not
	// the caching getInlineContent accessor — the cache is non-reactive, so reading
	// it here would skip render-relevant changes (invariants G4.2).
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
				// Attribute-only stamps for the construct-reveal trigger; mode-gated so
				// the other modes' DOM stays byte-identical (the renderKey's mode segment
				// already forces the rebuild on a flip).
				tagConstructMarkers: deps.presentationMode === 'preview-inline'
			})
		);
		return frag;
	}

	// Non-prose marker line: a dimmed `.md-marker` span over the fence, then the
	// remainder as a raw text node. No inline pass runs, so the text is verbatim.
	function buildMarkerPrefixDOM(marker: string, rest: string): DocumentFragment {
		const frag = document.createDocumentFragment();
		const span = document.createElement('span');
		span.className = 'md-marker';
		span.textContent = marker;
		frag.appendChild(span);
		frag.appendChild(document.createTextNode(rest));
		return frag;
	}

	// A `<br>` inside an island belongs to the widget, not the block — it must
	// not satisfy the empty block's caret anchor.
	function ensureBr(el: HTMLElement): void {
		if (deps.getDisplayText() !== '') return;
		const hasAnchorBr = [...el.querySelectorAll('br')].some(
			(br) => !br.closest('[data-decoration-island]')
		);
		if (!hasAnchorBr) el.appendChild(document.createElement('br'));
	}

	// An island-signature change rebuilds the focused block's DOM with no
	// edit-path pendingCursorOffset set; carry the caret across in walk space.
	// The SFC's pending restore (when an edit set one) runs after and wins.
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
		// A block can only resolve through an LRD if it contains a bracket. Gate
		// both the signature dependency and the resolver read on it: a bracketless
		// block reads neither, so an LRD change never invalidates it. Without this,
		// every block subscribes to the resolver and one LRD edit re-renders the
		// whole document.
		const hasRef = node.raw.includes('[');
		const refKeyPart = hasRef ? deps.linkStamp : '';
		// The built widget bakes in imageLoadPolicy (placeholder class / src), so the
		// key must track it — but only for blocks with an image, so image-free blocks
		// neither subscribe to policy changes nor rebuild when the policy flips.
		const hasImg = node.raw.includes('![');
		const imgKeyPart = hasImg ? deps.imageLoadPolicy : '';
		// Unconditional (unlike ref/img gating): a mode flip re-renders every
		// mounted block. '' in source keeps the default key one NUL longer and
		// otherwise byte-identical — the sanctioned default-path change.
		const mode = deps.presentationMode;
		const modeKeyPart = mode === 'source' ? '' : mode;
		const islands = deps.islands;
		const renderKey = `${deps.ambientPrefixText}\0${node.raw}\0${refKeyPart}\0${imgKeyPart}\0${modeKeyPart}${islandRenderKeyPart(islands)}`;
		const forceRebuild = opts?.forceRebuild ?? false;
		const carryCaret = opts?.carryCaret ?? true;

		if (isProseKind(node.kind)) {
			if (renderKey === lastRenderedKey && !forceRebuild) return;
			// Detail assembly (the segment diff) allocates, so it stays behind the gate.
			if (isInteractionTraceEnabled())
				traceRebuild(renderKeySegmentDiff(lastRenderedKey, renderKey), forceRebuild);
			const content = computeInlineContent(node, hasRef ? deps.linkResolver : undefined);
			// Edit-path rebuilds (carryCaret false) skip the capture/restore pair: the
			// SFC's pending-cursor restore overwrites the selection right after, so the
			// walk is dead work. When focus already left, capture returns null and the
			// SFC restore skips too — so skipping here is behavior-identical either way.
			const caretWalkOffset = carryCaret ? captureCaretIfFocused(el) : null;
			// Bracket the rebuild: portal widgets acquired during the build are adopted
			// for this pass; the sweep destroys any that the previous DOM held but this
			// build did not re-acquire (a widget whose source changed or was deleted).
			// Island widgets are unpooled — destroy last pass's, mount this pass's.
			widgetPool.beginPass();
			destroyIslands();
			el.replaceChildren(buildInlineDOM(content));
			islandDestroys = applyIslandDecorations(el, node.raw, islands, {
				ambientLength: deps.ambientPrefixText.length,
				mountWidget: (spec, dec) => mountDecorationWidget(spec, dec, deps.reportRenderError),
				onSkipped: (dec, reason) => devWarn('decorations', `island skipped: ${reason}`, dec)
			});
			if (islands.length > 0) {
				recordIslandRebuild();
				traceIslandsApplied(islands.length);
			}
			widgetPool.sweep();
			if (caretWalkOffset !== null) restoreCaret(el, caretWalkOffset);
		} else {
			// A non-prose kind builds no inline widgets or islands, so an empty pass
			// here sweeps any pooled widget — and the destroy run any island — stranded
			// by an in-place prose→non-prose kind change (the same TextEditableBlock
			// instance is reused across the transition).
			widgetPool.beginPass();
			destroyIslands();
			widgetPool.sweep();
			const display = deps.getDisplayText();
			const markerPrefix = getBlockMarkerPrefix();
			if (markerPrefix) {
				// A non-prose kind with a marker (the directive leaf's `::name`): dim the
				// fence like a heading marker, render the remainder as plain text. The line
				// stays one editable coordinate space, so an edit that breaks the fence
				// reparses to the natural kind.
				if (el.textContent !== display || forceRebuild) {
					el.replaceChildren(
						buildMarkerPrefixDOM(markerPrefix, display.slice(markerPrefix.length))
					);
				}
			} else if (el.textContent !== display) {
				el.textContent = display;
			}
		}

		// Record the key unconditionally: after this pass the DOM reflects
		// renderKey even when an arm skipped its write because the text already
		// matched. Updating only on a write froze the key across a prose→non-prose
		// flip whose DOM the browser had already mutated, and a later prose render
		// with the frozen key wrongly early-returned onto stale DOM.
		lastRenderedKey = renderKey;
		ensureBr(el);
	}

	return {
		render,
		dispose: () => {
			destroyIslands();
			widgetPool.dispose();
		}
	};
}
