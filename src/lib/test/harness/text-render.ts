// Shared TextRenderDeps harness: one passive deps object over a mutable state bag, read
// through getters so a knob flipped between renders is what the memo key sees. Every
// behaviour a test asserts on must come from its own knob or overrides.
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { TextRenderDeps } from '$lib/components/blocks/text/text-render';
import type { CstNode } from '$lib/core/nodes';
import type { PresentationMode } from '$lib/presentation-mode';
import type { ImageLoadPolicy } from '$lib/core/inline-render';
import type { IndexedDecoration } from '$lib/decorations/buckets';
import type { ReplaceDecoration, WidgetDecoration } from '$lib/decorations/types';

export type Island = IndexedDecoration<WidgetDecoration | ReplaceDecoration>;

export function blockNode(source: string): CstNode {
	const node = parse(source).children[0];
	if (!node) throw new Error('expected a block node');
	return node;
}

export interface RenderHarnessOverrides {
	mode?: PresentationMode;
	imageLoadPolicy?: ImageLoadPolicy;
	linkResolver?: TextRenderDeps['linkResolver'];
	linkStamp?: string;
}

export interface RenderHarness {
	el: HTMLElement;
	deps: TextRenderDeps;
	setNode: (next: CstNode) => void;
	setIslands: (next: Island[]) => void;
	setMode: (next: PresentationMode) => void;
	setPolicy: (next: ImageLoadPolicy) => void;
}

export function makeRenderHarness(
	initialNode: CstNode,
	overrides: RenderHarnessOverrides = {}
): RenderHarness {
	const el = document.createElement('div');
	el.tabIndex = 0;
	document.body.appendChild(el);
	let node = initialNode;
	let islands: Island[] = [];
	let mode: PresentationMode = overrides.mode ?? 'source';
	let policy: ImageLoadPolicy = overrides.imageLoadPolicy ?? 'auto';
	const deps: TextRenderDeps = {
		get el() {
			return el;
		},
		get node() {
			return node;
		},
		get ambientPrefix() {
			return '';
		},
		get ambientPrefixText() {
			return '';
		},
		getDisplayText: () => trimTrailingLineEnding(node.raw),
		resolveImageUrl: (u) => u,
		resolveLinkUrl: (u) => u,
		get imageLoadPolicy() {
			return policy;
		},
		get presentationMode() {
			return mode;
		},
		get linkResolver() {
			return overrides.linkResolver;
		},
		get linkStamp() {
			return overrides.linkStamp ?? '0';
		},
		get islands() {
			return islands;
		},
		getDocument: () => undefined,
		brokenUrlCache: new Set<string>()
	};
	return {
		el,
		deps,
		setNode: (next) => (node = next),
		setIslands: (next) => (islands = next),
		setMode: (next) => (mode = next),
		setPolicy: (next) => (policy = next)
	};
}
