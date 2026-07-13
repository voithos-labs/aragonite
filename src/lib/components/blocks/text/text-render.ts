/**
 * DOM-build steps for TextEditableBlock's render $effect. The component
 * owns the effect (Svelte reactivity entry point); this factory owns the
 * imperative inline-DOM construction it dispatches to.
 *
 * Cursor save/restore stays in the SFC — those writes touch $state.
 */

import type { AmbientPrefix } from '../../../block-component';
import type { CstNode } from '../../../core/nodes';
import type { ResolveImageUrl, ResolveLinkUrl } from '../../../editor-keys';
import { buildAmbientSpan } from '../../../ambient/ambient-dom';
import { computeInlineContent, getContentRange, isProseKind } from '../../../core/inline';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import { renderInlineNodes, type ImageLoadPolicy } from '../../../core/inline-render';
import { buildImageWidget } from '../../image/widget-dom';
import type { InlineNode } from '../../../core/nodes';
import { getBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
import { createSvelteWidgetPool } from '../widget-portal';

export interface TextRenderDeps {
	get el(): HTMLElement | null;
	get node(): CstNode;
	get ambientPrefix(): AmbientPrefix;
	get ambientPrefixText(): string;
	getDisplayText: () => string;
	resolveImageUrl: ResolveImageUrl;
	resolveLinkUrl: ResolveLinkUrl;
	get imageLoadPolicy(): ImageLoadPolicy;
	get linkResolver(): LinkReferenceResolver | undefined;
	get linkSignature(): string;
	brokenUrlCache: Set<string>;
	/** A widget component's synchronous mount throw is routed here — the editor's
	 *  `error` channel, matching BlockHost's render-boundary origin. Absent → errors
	 *  are not surfaced (the widget still falls back to its raw source). */
	reportRenderError?: (error: unknown) => void;
}

export interface TextRender {
	/**
	 * Rebuild the block's children from current node state. Skips work when
	 * neither (ambientPrefixText, raw, ref-signature, image-policy) nor
	 * `forceRebuild` demands it. Pass `forceRebuild` when a pending cursor
	 * restoration needs the DOM positions re-anchored even though the rendered
	 * key is unchanged.
	 */
	render(opts?: { forceRebuild?: boolean }): void;
	/** Destroy every pooled widget instance — called when the block unmounts. */
	dispose(): void;
}

export function createTextRender(deps: TextRenderDeps): TextRender {
	let lastRenderedKey = '';
	const widgetPool = createSvelteWidgetPool(deps.reportRenderError);

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

	function ensureBr(el: HTMLElement): void {
		if (deps.getDisplayText() === '' && !el.querySelector('br')) {
			el.appendChild(document.createElement('br'));
		}
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
		const renderKey = `${deps.ambientPrefixText}\0${node.raw}\0${refKeyPart}\0${imgKeyPart}`;
		const forceRebuild = opts?.forceRebuild ?? false;

		if (isProseKind(node.kind)) {
			if (renderKey === lastRenderedKey && !forceRebuild) return;
			const content = computeInlineContent(node, hasRef ? deps.linkResolver : undefined);
			// Bracket the rebuild: portal widgets acquired during the build are adopted
			// for this pass; the sweep destroys any that the previous DOM held but this
			// build did not re-acquire (a widget whose source changed or was deleted).
			widgetPool.beginPass();
			el.replaceChildren(buildInlineDOM(content));
			widgetPool.sweep();
			lastRenderedKey = renderKey;
		} else {
			// A non-prose kind builds no inline widgets, so an empty pass here sweeps any
			// pooled widget stranded by an in-place prose→non-prose kind change (the same
			// TextEditableBlock instance is reused across the transition).
			widgetPool.beginPass();
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

	return { render, dispose: () => widgetPool.dispose() };
}
