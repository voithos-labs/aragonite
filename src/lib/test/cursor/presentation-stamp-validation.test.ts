// @vitest-environment jsdom
// The `data-presentation` attribute is read by the CSS and the caret traversal, and only the CSS
// matches known values, so an unrecognized value must read as source here or the two disagree.
// A block decoration can write one, so such a value arrives through a supported API.
// Miss-analysis: every traversal suite wrote a real mode, so nothing exercised the fallback.
import { describe, it, expect, afterEach } from 'vitest';
import { asPresentationMode } from '#lib/presentation-mode.js';
import { revealsNoMarkers, screenVisibilityOf } from '#lib/cursor/widget-offset.js';

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
	it('keeps every inline syntax handler of the contract', () => {
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

	// A membership test written with `in` admits every `Object.prototype` key, which is exactly
	// what a forged value would reach for.
	it('falls back for an inherited object key', () => {
		expect(asPresentationMode('constructor')).toBe('source');
		expect(asPresentationMode('toString')).toBe('source');
	});
});

describe('the walk over a forged mark', () => {
	it('treats an unknown mark as painting its markers', () => {
		expect(revealsNoMarkers(stamp('garbage'))).toBe(false);
	});

	it('reads an unknown mark as the source visibility context', () => {
		expect(screenVisibilityOf(stamp('garbage'))).toEqual({
			hidesMarkers: false,
			chromePaints: false
		});
	});

	it('still reads a real mark as hiding', () => {
		expect(revealsNoMarkers(stamp('live'))).toBe(true);
		expect(screenVisibilityOf(stamp('live'))).toEqual({ hidesMarkers: true, chromePaints: false });
	});
});
