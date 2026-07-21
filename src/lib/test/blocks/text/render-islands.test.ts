// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createTextRender, type TextRenderDeps } from '$lib/components/blocks/text/text-render';
import { islandRenderKeyPart } from '$lib/decorations/island-dom';
import {
	disableInteractionTrace,
	enableInteractionTrace,
	interactionTraceSnapshot,
	resetInteractionTrace
} from '$lib/debug/interaction-trace';
import type { CstNode } from '$lib/core/nodes';
import type { IndexedDecoration } from '$lib/decorations/buckets';
import type { ReplaceDecoration, WidgetDecoration } from '$lib/decorations/types';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { domTextOffsetAtNode } from '$lib/cursor/widget-offset';

type Island = IndexedDecoration<WidgetDecoration | ReplaceDecoration>;

function blockNode(source: string): CstNode {
	const node = parse(source).children[0];
	if (!node) throw new Error('expected a block node');
	return node;
}

function makeHarness(initialNode: CstNode) {
	const el = document.createElement('div');
	el.tabIndex = 0;
	document.body.appendChild(el);
	let node = initialNode;
	let islands: Island[] = [];
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
			return 'auto' as const;
		},
		get linkResolver() {
			return undefined;
		},
		get linkStamp() {
			return '0';
		},
		get islands() {
			return islands;
		},
		get presentationMode() {
			return 'source' as const;
		},
		brokenUrlCache: new Set<string>()
	};
	return {
		el,
		deps,
		setIslands: (next: Island[]) => (islands = next),
		setNode: (next: CstNode) => (node = next)
	};
}

const widgetIsland = (offset: number, buildDom?: () => HTMLElement): Island => ({
	index: 0,
	dec: {
		type: 'widget',
		path: [0],
		offset,
		widget: { buildDom: buildDom ?? (() => document.createElement('span')) }
	}
});

describe('text-render island wiring', () => {
	it('no islands contribute nothing to the render key (zero-cost parity)', () => {
		expect(islandRenderKeyPart([])).toBe('');
	});

	it('an empty island set never rebuilds, even across fresh array identities', () => {
		const { el, deps, setIslands } = makeHarness(blockNode('hello world\n'));
		const render = createTextRender(deps);
		render.render();
		const firstChild = el.firstChild;
		setIslands([]);
		render.render();
		expect(el.firstChild).toBe(firstChild);
	});

	it('an island set renders islands; an unchanged signature does not rebuild', () => {
		const { el, deps, setIslands } = makeHarness(blockNode('hello world\n'));
		const render = createTextRender(deps);
		setIslands([widgetIsland(5)]);
		render.render();
		const island = el.querySelector('[data-decoration-island]');
		expect(island).not.toBeNull();
		setIslands([widgetIsland(5)]); // equal signature, fresh objects
		render.render();
		expect(el.querySelector('[data-decoration-island]')).toBe(island);
	});

	it('a signature change rebuilds: old widget destroyed, new one mounted', () => {
		let builds = 0;
		const buildDom = () => {
			builds++;
			return document.createElement('span');
		};
		const { el, deps, setIslands } = makeHarness(blockNode('hello world\n'));
		const render = createTextRender(deps);
		setIslands([widgetIsland(5, buildDom)]);
		render.render();
		const first = el.querySelector('[data-decoration-island]')!;
		expect(builds).toBe(1);
		setIslands([widgetIsland(7, buildDom)]);
		render.render();
		expect(builds).toBe(2);
		expect(first.isConnected).toBe(false);
		expect(el.querySelector('[data-decoration-island]')!.getAttribute('data-source-start')).toBe(
			'7'
		);
	});

	it('the caret survives an island-signature rebuild of the focused block', () => {
		const { el, deps, setIslands } = makeHarness(blockNode('hello world\n'));
		const render = createTextRender(deps);
		render.render();
		el.focus();
		const textNode = el.firstChild!;
		const range = document.createRange();
		range.setStart(textNode, 7);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);

		setIslands([widgetIsland(2)]);
		render.render();

		const after = window.getSelection()!;
		expect(after.focusNode).not.toBeNull();
		expect(el.contains(after.focusNode)).toBe(true);
		expect(domTextOffsetAtNode(el, after.focusNode!, after.focusOffset)).toBe(7);
	});

	it("an island widget's own <br> does not satisfy the empty block's caret anchor", () => {
		const emptyParagraph: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
		const { el, deps, setIslands } = makeHarness(emptyParagraph);
		const render = createTextRender(deps);
		setIslands([
			widgetIsland(0, () => {
				const span = document.createElement('span');
				span.appendChild(document.createElement('br'));
				return span;
			})
		]);
		render.render();
		const anchorBrs = [...el.querySelectorAll('br')].filter(
			(br) => !br.closest('[data-decoration-island]')
		);
		expect(anchorBrs.length).toBe(1);
	});

	it('a prose→non-prose kind change destroys stranded islands', () => {
		const { el, deps, setIslands, setNode } = makeHarness(blockNode('hello world\n'));
		const render = createTextRender(deps);
		setIslands([widgetIsland(5)]);
		render.render();
		expect(el.querySelector('[data-decoration-island]')).not.toBeNull();

		setNode(blockNode('```js\ncode\n```\n'));
		setIslands([]);
		render.render();
		expect(el.querySelector('[data-decoration-island]')).toBeNull();
	});
});

// ── Caret-carry gate (the edit path skips the render's own walk) ───────────────

describe('caret-carry gate', () => {
	beforeEach(() => {
		enableInteractionTrace();
		resetInteractionTrace();
	});
	afterEach(() => {
		disableInteractionTrace();
		resetInteractionTrace();
	});

	function focusCaretAt(el: HTMLElement, offset: number): void {
		el.focus();
		const range = document.createRange();
		range.setStart(el.firstChild!, offset);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	const renderTraceKinds = () =>
		interactionTraceSnapshot()
			.filter((e) => e.site === 'text-render')
			.map((e) => e.kind);

	it('carryCaret:false skips the capture/restore pair on the edit path', () => {
		const { el, deps } = makeHarness(blockNode('hello world\n'));
		const render = createTextRender(deps);
		render.render();
		focusCaretAt(el, 7);
		resetInteractionTrace();
		render.render({ carryCaret: false, forceRebuild: true });
		expect(renderTraceKinds()).not.toContain('cursor-capture');
		expect(renderTraceKinds()).not.toContain('cursor-restore');
	});

	it('the default carry re-anchors the caret across an island-signature rebuild', () => {
		const { el, deps, setIslands } = makeHarness(blockNode('hello world\n'));
		const render = createTextRender(deps);
		render.render();
		focusCaretAt(el, 7);
		resetInteractionTrace();
		setIslands([widgetIsland(2)]);
		render.render(); // default carryCaret true, no pending offset
		expect(renderTraceKinds()).toContain('cursor-capture');
		expect(renderTraceKinds()).toContain('cursor-restore');
	});
});
