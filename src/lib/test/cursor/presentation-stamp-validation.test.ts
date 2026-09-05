// @vitest-environment jsdom
//
// The `data-presentation` stamp is read by the CSS families and by the caret walk, and only the
// CSS half matches known values: an unrecognized stamp must read as source here or the two mirrors
// diverge over the same block (#125). A block decoration can write one (E-F3), so this is reachable
// through a supported API rather than only by direct DOM writes.
// Miss-analysis: every walk suite stamps a real mode, so no test ever handed the reader a value the
// stylesheet has no rule for — the fallback arm was exercised by nothing.
import { describe, it, expect, afterEach } from 'vitest';
import { asPresentationMode } from '$lib/presentation-mode';
import { revealsNoMarkers, screenVisibilityOf } from '$lib/cursor/widget-offset';

function stamp(value: string): HTMLElement {
	const root = document.createElement('div');
	root.className = 'editor';
	root.setAttribute('data-presentation', value);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	root.appendChild(block);
	document.body.appendChild(root);
	return block;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('asPresentationMode', () => {
	it('keeps every rung of the contract', () => {
		for (const mode of ['source', 'reading', 'preview-block', 'preview-inline', 'live'] as const) {
			expect(asPresentationMode(mode)).toBe(mode);
		}
	});

	it('falls back to source for a value the stylesheet has no rule for', () => {
		expect(asPresentationMode('garbage')).toBe('source');
		expect(asPresentationMode('LIVE')).toBe('source');
		expect(asPresentationMode('')).toBe('source');
		expect(asPresentationMode(null)).toBe('source');
		expect(asPresentationMode(undefined)).toBe('source');
	});

	// A membership test written with `in` admits every Object.prototype key, which is exactly the
	// shape a forged stamp reaches for.
	it('falls back for an inherited object key', () => {
		expect(asPresentationMode('constructor')).toBe('source');
		expect(asPresentationMode('toString')).toBe('source');
	});
});

describe('the walk over a forged stamp', () => {
	it('treats an unknown stamp as painting its markers', () => {
		expect(revealsNoMarkers(stamp('garbage'))).toBe(false);
	});

	it('reads an unknown stamp as the source visibility context', () => {
		expect(screenVisibilityOf(stamp('garbage'))).toEqual({
			hidesMarkers: false,
			chromePaints: false
		});
	});

	it('still reads a real stamp as hiding', () => {
		expect(revealsNoMarkers(stamp('live'))).toBe(true);
		expect(screenVisibilityOf(stamp('live'))).toEqual({ hidesMarkers: true, chromePaints: false });
	});
});
