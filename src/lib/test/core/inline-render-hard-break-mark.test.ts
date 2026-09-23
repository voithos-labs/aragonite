// @vitest-environment jsdom
// Miss-analysis: the hard-break tests pinned only that the rendered text equals the bytes, so
// nothing asked what a mode that hides the break's bytes leaves in their place: nothing at all.
import { describe, it, expect } from 'vitest';
import { renderInlineNodes } from '../../core/inline-render';
import { parseInline } from '../../core/inline';
import { renderedText, screenVisibility } from '../../core/inline/visibility';

// A hard break carries a mark the stylesheet draws as a dimmed return glyph where its bytes do not
// show (editor.css). The mark wraps the marker and holds no text of its own, so the offsets, the
// copy and the hiding rule read exactly the bytes they read without it.

function render(raw: string) {
	const nodes = parseInline(raw, 0, raw.length);
	const host = document.createElement('div');
	host.appendChild(renderInlineNodes(nodes, raw));
	return { nodes, host };
}

describe('the hard-break mark', () => {
	it.each([
		['backslash', 'one\\\ntwo', '\\', false],
		['backslash CRLF', 'one\\\r\ntwo', '\\', false],
		['two spaces', 'one  \ntwo', '  ', true],
		['three spaces CRLF', 'one   \r\ntwo', '   ', true]
	])('%s: the marker sits in a mark that adds no text', (_, raw, markerText, spaces) => {
		const { host } = render(raw);
		const mark = host.querySelector('.md-hard-break');
		expect(mark).not.toBeNull();
		expect(mark!.querySelector('.md-marker')?.textContent).toBe(markerText);
		expect(mark!.textContent).toBe(markerText);
		expect(mark!.hasAttribute('data-trailing-spaces')).toBe(spaces);
		expect(host.textContent).toBe(raw);
	});

	it('the hiding rule reads the break the same way with the mark around it', () => {
		const raw = 'one  \ntwo';
		const { nodes } = render(raw);
		const shown = (mode: 'live' | 'source') =>
			renderedText(nodes, raw, screenVisibility(mode, { chromePaints: false }));
		expect(shown('live')).toBe('one\ntwo');
		expect(shown('source')).toBe(raw);
	});

	it('a soft break (one space or none before the newline) carries no mark', () => {
		expect(render('one \ntwo').host.querySelector('.md-hard-break')).toBeNull();
		expect(render('one\ntwo').host.querySelector('.md-hard-break')).toBeNull();
	});
});
