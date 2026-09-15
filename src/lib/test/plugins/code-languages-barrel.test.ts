// @vitest-environment jsdom
//
// The code-block language surface as a plugin author holds it: only the published barrel, so a
// re-export that drifts from the registry behind it fails here rather than in a host's build.
import { describe, it, expect } from 'vitest';
import latex from 'highlight.js/lib/languages/latex';
import { getLanguageAliases, highlightCode, listLanguages, registerLanguage } from '$lib/plugin';

describe('the plugin barrel’s code-language surface', () => {
	it('round-trips a registered grammar into the picker’s list, its alias folded in', () => {
		registerLanguage('latex', latex, ['tex']);

		expect(listLanguages()).toContain('latex');
		expect(listLanguages()).not.toContain('tex');
		// The list is canonical, so the folded spellings stay reachable for a host's own picker.
		expect(getLanguageAliases('latex')).toContain('tex');
	});

	it('highlights text-preservingly, through the registered name and its alias', () => {
		registerLanguage('latex', latex, ['tex']);
		const body = '\\begin{aligned}\na &= b \\\\\n\\end{aligned}\n';

		for (const language of ['latex', 'tex']) {
			const painted = highlightCode(body, language);
			expect(painted.textContent).toBe(body);
			expect(painted.querySelector('[class^="code-tok"]')).not.toBeNull();
		}
	});

	it('paints an unregistered language as plain text, byte for byte', () => {
		const body = 'x^2 + y^2\n';
		const painted = highlightCode(body, 'no-such-grammar');

		expect(painted.textContent).toBe(body);
		expect(painted.querySelector('[class^="code-tok"]')).toBeNull();
	});
});
