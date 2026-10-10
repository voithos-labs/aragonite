// Shared TextRenderDeps harness: one passive deps object over a mutable state bag, read
// through getters so a knob flipped between renders is what the memo key sees. Every
// behaviour a test asserts on must come from its own knob or overrides.
import { parse } from '#lib/core/parser.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import type { TextRenderDeps } from '#lib/components/blocks/text/text-render.js';
import type { CstNode } from '#lib/core/nodes.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { ImageLoadPolicy } from '#lib/core/inline-render.js';
import type { IndexedDecoration } from '#lib/decorations/buckets.js';
import type { ReplaceDecoration, WidgetDecoration } from '#lib/decorations/types.js';
import type { Reading } from '#lib/schema/reading.js';
import { fixtureReading } from './fixture-grammar';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

export type Island = IndexedDecoration<WidgetDecoration | ReplaceDecoration>;

export function blockNode(source: string): CstNode {
	const node = parse(source).children[0];
	if (!node) throw new Error('expected a block node');
	return node;
}

export interface RenderHarnessOverrides {
	mode?: PresentationMode;
	imageLoadPolicy?: ImageLoadPolicy;
	/** The theme its widgets draw with; the harness has no editor to take one from. */
	theme?: string;
	/** The link definitions the block draws with; the mode stays the harness's own. */
	reading?: Partial<Reading>;
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
	let version = 0;
	const deps: TextRenderDeps = {
		caretWriter: testCaretWriter,
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
		pendingBreakLines: () => 0,
		resolveImageUrl: (u) => u,
		resolveLinkUrl: (u) => u,
		get imageLoadPolicy() {
			return policy;
		},
		reading: fixtureReading({ ...overrides.reading, mode: () => mode }),
		getTheme: () => overrides.theme ?? 'dark',
		get islands() {
			return islands;
		},
		getDocument: () => undefined,
		// New on every read, so a widget memo keyed on it never serves a stale document.
		getContentVersion: () => ++version,
		navigateTo: async () => false,
		activationClick: () => false,
		reportRenderError: () => {},
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
