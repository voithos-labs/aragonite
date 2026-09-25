// @vitest-environment jsdom
//
// The code-block language API as a plugin author sees it: only the published barrel, so a
// re-export that drifts from the registry behind it fails here rather than in a host's build.
import { describe, it, expect, beforeEach } from 'vitest';
import latex from 'highlight.js/lib/languages/latex';
import { getLanguageAliases, highlightCode, listLanguages, registerLanguage } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';

// A name the code bootstrap does not register, so each case registers it afresh.
beforeEach(() => resetPluginPlatformForTests());

describe('the plugin barrel’s code-language surface', () => {
	it('round-trips a registered grammar into the picker’s list, its alias folded in', () => {
		registerLanguage('probe-latex', latex, ['probe-tex']);

		expect(listLanguages()).toContain('probe-latex');
		expect(listLanguages()).not.toContain('probe-tex');
		// The list is canonical, so the alias spellings stay reachable for a host's own picker.
		expect(getLanguageAliases('probe-latex')).toContain('probe-tex');
	});

	it('highlights text-preservingly, through the registered name and its alias', () => {
		registerLanguage('probe-latex', latex, ['probe-tex']);
		const body = '\\begin{aligned}\na &= b \\\\\n\\end{aligned}\n';

		for (const language of ['probe-latex', 'probe-tex']) {
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
