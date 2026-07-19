/**
 * Drift guard for the published theme-token manifest (consumer-guide "Theme
 * tokens" + the plugin-guide styling table). The docs promise plugins a stable
 * set of host-chrome tokens; this pins that promise to `editor-theme.css` so a
 * renamed or dropped token fails here instead of silently rendering a plugin's
 * inline fallback forever.
 *
 * The both-themes guarantee is the contract: a themed token carries a light AND a
 * dark value, so it must appear in the base block and the `[data-editor-theme=
 * 'light']` override block. `--font-editor` is mode-independent — declared once in
 * the base, inherited by light — so it is checked in the base only.
 *
 * THEMED_TOKENS / MODE_INDEPENDENT_TOKENS mirror the doc manifest by hand; keep
 * the three in lockstep. A token added to the docs without an entry here (or
 * vice versa) is the drift this guard exists to surface.
 */
import { describe, it, expect } from 'vitest';
import { readEditorFile, stripComments } from './scan-source';

const THEMED_TOKENS = [
	'--color-bg',
	'--color-bg-secondary',
	'--color-bg-elevated',
	'--color-bg-muted',
	'--color-text',
	'--color-text-primary',
	'--color-text-muted',
	'--color-ui-muted',
	'--color-ui-dulled',
	'--color-accent',
	'--color-border',
	'--color-danger'
];

const MODE_INDEPENDENT_TOKENS = ['--font-editor'];

const LIGHT_SELECTOR = "[data-editor-theme='light']";

function themeBlocks(): { base: string; light: string } {
	const css = stripComments(readEditorFile('styles/editor-theme.css').text);
	const splitAt = css.indexOf(LIGHT_SELECTOR);
	return { base: css.slice(0, splitAt), light: css.slice(splitAt) };
}

function declares(block: string, token: string): boolean {
	return new RegExp(`${token}\\s*:`).test(block);
}

describe('theme-token manifest ↔ editor-theme.css', () => {
	const { base, light } = themeBlocks();

	it.each(THEMED_TOKENS)('%s carries a value in both the dark base and light blocks', (token) => {
		expect(declares(base, token), `${token} missing from the dark base block`).toBe(true);
		expect(declares(light, token), `${token} missing from the light override block`).toBe(true);
	});

	it.each(MODE_INDEPENDENT_TOKENS)('%s is declared once in the base block', (token) => {
		expect(declares(base, token), `${token} missing from the dark base block`).toBe(true);
	});

	// Non-vacuity: the split must isolate two real blocks and the matcher must be
	// able to say "no". Without this a broken split (empty light block) would pass
	// every "both" assertion vacuously.
	it('the block split and matcher are non-vacuous', () => {
		const css = stripComments(readEditorFile('styles/editor-theme.css').text);
		expect(css.indexOf(LIGHT_SELECTOR)).toBeGreaterThan(0);
		expect(declares(base, '--color-danger')).toBe(true);
		expect(declares(light, '--color-danger')).toBe(true);
		// A base-only token is absent from the light block — proves the split is real.
		expect(declares(light, '--font-editor')).toBe(false);
		expect(declares(base, '--not-a-real-token')).toBe(false);
	});
});
