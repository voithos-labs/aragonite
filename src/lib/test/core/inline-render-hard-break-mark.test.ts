// @vitest-environment jsdom
// Miss-analysis: hard-break tests checked only the rendered text, never a mode hiding its bytes.
import { describe, it, expect } from 'vitest';
import { renderInlineNodes } from '../../core/inline-render';
import { parseInline } from '../../core/inline';
import { renderedText, screenVisibility } from '../../core/inline/visibility';
import { renderOptions } from '../harness/fixture-grammar';

// A trailing-space hard break sits in a mark source mode draws a return glyph on (editor.css); the
// mark holds no text, so the offsets, the copy and the hiding rule read the same bytes as without it.

function render(raw: string) {
	const nodes = parseInline(raw, 0, raw.length);
	const host = document.createElement('div');
	host.appendChild(renderInlineNodes(nodes, raw, renderOptions()));
	return { nodes, host };
}

describe('the hard-break mark', () => {
	it.each([
		['two spaces', 'one  \ntwo', '  '],
		['three spaces CRLF', 'one   \r\ntwo', '   ']
	])('%s: the marker sits in a mark that adds no text', (_, raw, markerText) => {
		const { host } = render(raw);
		const mark = host.querySelector('.md-hard-break');
		expect(mark).not.toBeNull();
		expect(mark!.querySelector('.md-marker')?.textContent).toBe(markerText);
		expect(mark!.textContent).toBe(markerText);
		expect(host.textContent).toBe(raw);
	});

	it.each([
		['backslash', 'one\\\ntwo'],
		['backslash CRLF', 'one\\\r\ntwo']
	])('%s: the marker shows itself, with no mark around it', (_, raw) => {
		const { host } = render(raw);
		expect(host.querySelector('.md-hard-break')).toBeNull();
		expect(host.querySelector('.md-marker')?.textContent).toBe('\\');
		expect(host.textContent).toBe(raw);
	});

	it('the hiding rule reads the break the same way with the mark around it', () => {
		const raw = 'one  \ntwo';
		const { nodes } = render(raw);
		const shown = (mode: 'live' | 'source') =>
			renderedText(nodes, raw, screenVisibility(mode, { chromePaints: false }), renderOptions());
		expect(shown('live')).toBe('one\ntwo');
		expect(shown('source')).toBe(raw);
	});

	it('a soft break (one space or none before the newline) carries no mark', () => {
		expect(render('one \ntwo').host.querySelector('.md-hard-break')).toBeNull();
		expect(render('one\ntwo').host.querySelector('.md-hard-break')).toBeNull();
	});
});
