/**
 * DOM-build steps for TextEditableBlock's render $effect. The component
 * owns the effect (Svelte reactivity entry point); this factory owns the
 * imperative inline-DOM construction it dispatches to.
 *
 * The `pendingCursorOffset` restore stays in the SFC — those writes touch
 * $state. This factory only carries a live caret across its own rebuilds
 * (a decoration-driven rebuild has no edit-path pending offset).
 */

import type { AmbientPrefix } from '../../../block-component';
import type { NodeView } from '../../../core/node-views';
import type { ResolveImageUrl, ResolveLinkUrl } from '../../../editor-keys';
import { buildAmbientSpan } from '../../../ambient/ambient-dom';
import { computeInlineContent, getContentRange, isProseKind } from '../../../core/inline';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import { renderInlineNodes, type ImageLoadPolicy } from '../../../core/inline-render';
import type { DomTextOffset } from '../../../cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets, domTextOffsetAtNode } from '../../../cursor/widget-offset';
import type { IndexedDecoration } from '../../../decorations/buckets';
import { applyIslandDecorations } from '../../../decorations/island-dom';
import type { ReplaceDecoration, WidgetDecoration } from '../../../decorations/types';
import { mountDecorationWidget } from '../../../decorations/widget-dom';
import { devWarn } from '../../../dev-warn';
import { recordIslandRebuild } from '../../../perf/instruments';
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
	get linkResolver(): LinkReferenceResolver | undefined;
	get linkSignature(): string;
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
	 * neither (ambientPrefixText, raw, ref-signature, image-policy,
	 * island-signature) nor `forceRebuild` demands it. Pass `forceRebuild` when
	 * a pending cursor restoration needs the DOM positions re-anchored even
	 * though the rendered key is unchanged.
	 */
	render(opts?: { forceRebuild?: boolean }): void;
	/** Destroy every pooled widget instance — called when the block unmounts. */
	dispose(): void;
}

/** Gated island signature for the render key. No islands ⇒ '' — an undecorated
 *  block's key stays byte-identical to the island-free format (the zero-cost
 *  path; pinned by a parity test). Widget identity is deliberately untracked:
 *  same position + class ⇒ equal signature (see DecorationWidgetSpec). */
export function islandRenderKeyPart(
	islands: IndexedDecoration<WidgetDecoration | ReplaceDecoration>[]
): string {
	if (islands.length === 0) return '';
	return `\0${islands.map((i) => islandSig(i.dec)).join(';')}`;
}

const islandSig = (d: WidgetDecoration | ReplaceDecoration): string =>
	d.type === 'widget'
		? `w:${d.offset}:${d.side ?? 'after'}`
		: `r:${d.start}-${d.end}:${d.class ?? ''}:${d.widget ? 1 : 0}`;

export function createTextRender(deps: TextRenderDeps): TextRender {
	let lastRenderedKey = '';
	const widgetPool = createSvelteWidgetPool(deps.reportRenderError);
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
				buildPortalWidget
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
		if (!document.activeElement || !el.contains(document.activeElement)) return null;
		const sel = window.getSelection();
		if (!sel?.focusNode || !el.contains(sel.focusNode)) return null;
		return domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset);
	}

	function restoreCaret(el: HTMLElement, walkOffset: DomTextOffset): void {
		const range = createRangeAtDomTextOffsets(el, walkOffset, walkOffset);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function render(opts?: { forceRebuild?: boolean }): void {
		const el = deps.el;
		if (!el) return;
		const node = deps.node;
		// A block can only resolve through an LRD if it contains a bracket. Gate
		// both the signature dependency and the resolver read on it: a bracketless
		// block reads neither, so an LRD change never invalidates it. Without this,
		// every block subscribes to the resolver and one LRD edit re-renders the
		// whole document.
		const hasRef = node.raw.includes('[');
		const refKeyPart = hasRef ? deps.linkSignature : '';
		// The built widget bakes in imageLoadPolicy (placeholder class / src), so the
		// key must track it — but only for blocks with an image, so image-free blocks
		// neither subscribe to policy changes nor rebuild when the policy flips.
		const hasImg = node.raw.includes('![');
		const imgKeyPart = hasImg ? deps.imageLoadPolicy : '';
		const islands = deps.islands;
		const renderKey = `${deps.ambientPrefixText}\0${node.raw}\0${refKeyPart}\0${imgKeyPart}${islandRenderKeyPart(islands)}`;
		const forceRebuild = opts?.forceRebuild ?? false;

		if (isProseKind(node.kind)) {
			if (renderKey === lastRenderedKey && !forceRebuild) return;
			const content = computeInlineContent(node, hasRef ? deps.linkResolver : undefined);
			const caretWalkOffset = captureCaretIfFocused(el);
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
			if (islands.length > 0) recordIslandRebuild();
			widgetPool.sweep();
			if (caretWalkOffset !== null) restoreCaret(el, caretWalkOffset);
			lastRenderedKey = renderKey;
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
					lastRenderedKey = renderKey;
				}
			} else if (el.textContent !== display) {
				el.textContent = display;
				lastRenderedKey = renderKey;
			}
		}

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
