// @vitest-environment jsdom
// Miss-analysis: the cell render was tested against raw, references and decorations but never
// against the mode, so nothing asked whether it carried the same inputs a prose block does.
import { afterEach, describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { createCellRender, type CellRender } from '$lib/components/blocks/table/cell-render';
import { registerInlineSyntax } from '$lib/core/inline/scan/plugin-syntax';
import { registerInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { declarePluginInlineKind } from '$lib/schema/plugin-kind';
import type { CstNode } from '$lib/core/nodes';
import type { PresentationMode } from '$lib/presentation-mode';
import ModeReadingWidget from '../fixtures/ModeReadingWidget.svelte';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

const WIDGET_SOURCE = '%%w%%';

/** A `%%…%%` inline handler whose widget component renders the two live values. */
function registerModeWidget(): void {
	const kind = declarePluginInlineKind('modeReadingWidget');
	registerInlineSyntax('%', (raw, pos, end) => {
		if (!raw.startsWith('%%', pos)) return null;
		const close = raw.indexOf('%%', pos + 2);
		if (close < 0 || close + 2 > end) return null;
		return { kind, start: pos, end: close + 2, children: [] };
	});
	registerInlineWidgetKind(kind, { isWidget: () => true, component: ModeReadingWidget });
}

const rendered: CellRender[] = [];

afterEach(() => {
	for (const render of rendered.splice(0)) render.dispose();
	__resetSchemaRegistriesForTests();
});

function mountCell(raw: string) {
	const el = document.createElement('div');
	const node: CstNode = { kind: 'tableCell', leadingTrivia: '', raw };
	// $state, because production reads both terms off reactive editor policy: a plain
	// variable would let a widget's `$derived` cache the first value and pass anyway.
	let mode = $state<PresentationMode>('source');
	let theme = $state('light');
	const render = createCellRender({
		get el() {
			return el;
		},
		get node() {
			return node;
		},
		grammar: defaultGrammarView,
		get linkRef() {
			return undefined;
		},
		resolveLinkUrl: (u) => u,
		get presentationMode() {
			return mode;
		},
		getTheme: () => theme,
		getDocument: () => undefined,
		get islands() {
			return [];
		}
	});
	rendered.push(render);
	return {
		el,
		render,
		widgetText: () => el.querySelector('.mode-reading-widget')?.textContent ?? null,
		setMode(next: PresentationMode) {
			mode = next;
		},
		setTheme(next: string) {
			theme = next;
		}
	};
}

describe('cell-render presentation-mode key segment', () => {
	it('a mode flip rebuilds the cell, as it rebuilds a prose block', () => {
		const cell = mountCell('*x*');
		cell.render.render();
		const before = cell.el.firstChild;
		expect(before).not.toBeNull();

		cell.setMode('reading');
		cell.render.render();
		// The key gained its mode segment, so the DOM rebuilt; hiding stays CSS-only.
		expect(cell.el.firstChild).not.toBe(before);
		expect(cell.el.textContent).toBe('*x*');
	});

	it('a second render in a non-source mode does not rebuild', () => {
		const cell = mountCell('*x*');
		cell.setMode('preview-inline');
		cell.render.render();
		const first = cell.el.firstChild;
		cell.render.render();
		// The keystroke path pays for the term only when the mode actually moves.
		expect(cell.el.firstChild).toBe(first);
	});
});

describe('cell-render widget mode/theme threading', () => {
	it('a mode-reading widget in a cell reads the live mode across a flip', () => {
		registerModeWidget();
		const cell = mountCell(`a ${WIDGET_SOURCE} b`);
		cell.render.render();
		flushSync();
		expect(cell.widgetText()).toBe('source/light');

		cell.setMode('reading');
		cell.render.render();
		flushSync();
		expect(cell.widgetText()).toBe('reading/light');
	});

	it('a theme flip reaches the widget without rebuilding the cell', () => {
		registerModeWidget();
		const cell = mountCell(`a ${WIDGET_SOURCE} b`);
		cell.render.render();
		flushSync();
		const before = cell.el.firstChild;

		cell.setTheme('dark');
		cell.render.render();
		flushSync();
		// The theme is not part of the render key: the cell's own DOM is themed by CSS, so only
		// the widget reading the getter changes.
		expect(cell.el.firstChild).toBe(before);
		expect(cell.widgetText()).toBe('source/dark');
	});
});
