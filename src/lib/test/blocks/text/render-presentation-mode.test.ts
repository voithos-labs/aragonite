// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import { blockNode, makeRenderHarness } from './render-fixture';

describe('text-render presentation-mode key segment', () => {
	it('a mode flip rebuilds the block and the markers stay in the DOM', () => {
		const { el, deps, setMode } = makeRenderHarness(blockNode('**bold**\n'));
		const render = createTextRender(deps);

		render.render();
		const before = el.firstChild;
		expect(before).not.toBeNull();

		setMode('reading');
		render.render();
		// The key gained its mode segment, so the DOM rebuilt...
		expect(el.firstChild).not.toBe(before);
		// ...and hiding is CSS-only: every marker byte is still in the DOM text.
		expect(el.textContent).toBe('**bold**');
		expect(el.querySelectorAll('.md-marker').length).toBeGreaterThan(0);
	});

	it('preview-block carries its own mode segment (rebuilds, markers kept for CSS)', () => {
		const { el, deps, setMode } = makeRenderHarness(blockNode('**bold**\n'));
		const render = createTextRender(deps);

		render.render();
		const before = el.firstChild;

		setMode('preview-block');
		render.render();
		// Not folded into source — the segment differs, so the block rebuilds once
		// on the flip; per-block focus reveal is CSS on data-focused, never a rebuild.
		expect(el.firstChild).not.toBe(before);
		expect(el.textContent).toBe('**bold**');
		expect(el.querySelectorAll('.md-marker').length).toBeGreaterThan(0);
	});

	it('the same mode never rebuilds (source stays the zero-cost path)', () => {
		const { el, deps } = makeRenderHarness(blockNode('hello\n'));
		const render = createTextRender(deps);

		render.render();
		const first = el.firstChild;
		render.render();
		expect(el.firstChild).toBe(first);
	});

	it('preview-inline carries its own segment and stamps construct markers; other modes stay unstamped', () => {
		const { el, deps, setMode } = makeRenderHarness(blockNode('**bold** `code`\n'));
		const render = createTextRender(deps);

		// The stamp is mode-gated: source/reading/preview-block DOM is attribute-free.
		for (const mode of ['source', 'reading', 'preview-block'] as const) {
			setMode(mode);
			render.render();
			expect(el.querySelectorAll('[data-construct-start]').length).toBe(0);
		}

		const before = el.firstChild;
		setMode('preview-inline');
		render.render();
		// A distinct segment from preview-block — the flip rebuilds into stamped DOM.
		expect(el.firstChild).not.toBe(before);
		expect(el.textContent).toBe('**bold** `code`');
		// strong spans [0,8): both `**` markers carry its range; the ticks carry the
		// code span's — per-construct addressing, exactly what the reveal CSS keys on.
		const strongMarkers = el.querySelectorAll('[data-construct-start="0"][data-construct-end="8"]');
		expect(strongMarkers.length).toBe(2);
		const codeMarkers = el.querySelectorAll('[data-construct-start="9"][data-construct-end="15"]');
		expect(codeMarkers.length).toBe(2);
	});
});
