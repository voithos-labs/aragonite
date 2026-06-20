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

export interface TextRenderDeps {
	get el(): HTMLElement | null;
	get node(): CstNode;
	get ambientPrefix(): AmbientPrefix;
	get ambientPrefixText(): string;
	getDisplayText: () => string;
	resolveImageUrl: ResolveImageUrl;
	resolveLinkUrl: ResolveLinkUrl;
	get imageLoadPolicy(): ImageLoadPolicy;
	get myPath(): number[];
	get linkResolver(): LinkReferenceResolver | undefined;
	get linkSignature(): string;
	brokenUrlCache: Set<string>;
}

export interface TextRender {
	/**
	 * Rebuild the block's children from current node state. Skips work when
	 * neither (ambientPrefixText, raw, ref-signature) nor `forceRebuild` demands
	 * it. Pass `forceRebuild` when a pending cursor restoration needs the DOM
	 * positions re-anchored even though the rendered key is unchanged.
	 */
	render(opts?: { forceRebuild?: boolean }): void;
}

export function createTextRender(deps: TextRenderDeps): TextRender {
	let lastRenderedKey = '';

	function getBlockMarkerPrefix(): string {
		const node = deps.node;
		if (!isProseKind(node.kind)) return '';
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
				paragraphPath: deps.myPath,
				buildImageWidget: (imgNode, imgRaw, imgOpts) =>
					buildImageWidget(imgNode, imgRaw, { ...imgOpts, brokenUrlCache: deps.brokenUrlCache })
			})
		);
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
		const renderKey = `${deps.ambientPrefixText}\0${node.raw}\0${refKeyPart}`;
		const forceRebuild = opts?.forceRebuild ?? false;

		if (isProseKind(node.kind)) {
			if (renderKey === lastRenderedKey && !forceRebuild) return;
			const content = computeInlineContent(node, hasRef ? deps.linkResolver : undefined);
			el.replaceChildren(buildInlineDOM(content));
			lastRenderedKey = renderKey;
		} else {
			const display = deps.getDisplayText();
			if (el.textContent !== display) {
				el.textContent = display;
				lastRenderedKey = renderKey;
			}
		}

		ensureBr(el);
	}

	return { render };
}
