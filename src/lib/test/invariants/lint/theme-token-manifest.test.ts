/**
 * Drift guard for the published theme-token manifest — the consumer guide's "Theme
 * tokens" role table, which the plugin guide points authors at as the stable
 * host-chrome set. This pins that promise to `editor-theme.css` so a renamed or
 * dropped token fails here instead of silently rendering a plugin's inline fallback
 * forever.
 *
 * The both-themes guarantee is the contract: a themed token carries a light AND a
 * dark value, so it must appear in the base block and the `[data-editor-theme=
 * 'light']` override block. The font tokens are mode-independent — declared once in
 * the base, inherited by light — so they are checked in the base only.
 *
 * THEMED_TOKENS / MODE_INDEPENDENT_TOKENS are the pinned manifest. They are not a
 * hand-kept mirror: the set-equality test below derives the published set from the
 * guide's own table, so a token added to or dropped from the docs fails here rather
 * than drifting unpinned (which is exactly how `--color-ui-faint` went unguarded).
 *
 * Declared-in-both is not the same as responding to the mode: a token can satisfy it
 * with the SAME value twice, which is how `--color-ui-faint` shipped mode-blind. So
 * the values are compared too, and a deliberate one-value token must say so in
 * MODE_BLIND_BY_DESIGN rather than pass silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
	'--color-ui-faint',
	'--color-accent',
	'--color-border',
	'--color-danger'
];

const MODE_INDEPENDENT_TOKENS = ['--font-editor', '--editor-font-size'];

/** Themed tokens whose light value deliberately repeats the dark one, with the reason. */
const MODE_BLIND_BY_DESIGN: Record<string, string> = {
	'--color-accent': 'one brand accent, chosen to read on both palettes'
};

const LIGHT_SELECTOR = "[data-editor-theme='light']";

function themeBlocks(): { base: string; light: string } {
	const css = stripComments(readEditorFile('styles/editor-theme.css').text);
	const splitAt = css.indexOf(LIGHT_SELECTOR);
	return { base: css.slice(0, splitAt), light: css.slice(splitAt) };
}

function declares(block: string, token: string): boolean {
	return new RegExp(`${token}\\s*:`).test(block);
}

function declaredValue(block: string, token: string): string | null {
	return block.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))?.[1].trim() ?? null;
}

// ── The published manifest ──────────────────────────────────────────────────

/** The guide's "Theme tokens" section, bounded by the next `##` heading. */
function themeTokenSection(): string {
	const guide = readFileSync(path.resolve('docs/guide/consumer-guide.md'), 'utf8');
	return guide.split('### Theme tokens')[1]?.split('\n## ')[0] ?? '';
}

/**
 * Tokens named by the section's role table. Table rows only: the surrounding prose
 * names tokens too (the plugin-fallback example reads `--color-text-muted`), and a
 * manifest that absorbed prose would drift on an unrelated wording edit.
 */
function tokensInTable(section: string): string[] {
	const rows = section.split('\n').filter((line) => line.trimStart().startsWith('|'));
	const named = rows.flatMap((row) => row.match(/`(--[a-z-]+)`/g) ?? []);
	return [...new Set(named.map((token) => token.slice(1, -1)))].sort();
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

	it.each(THEMED_TOKENS)('%s actually responds to the mode (or says why it does not)', (token) => {
		const repeatsDarkValue = declaredValue(base, token) === declaredValue(light, token);
		expect(
			repeatsDarkValue ? token in MODE_BLIND_BY_DESIGN : true,
			`${token} repeats its dark value in the light block — give it a light value or record it in MODE_BLIND_BY_DESIGN`
		).toBe(true);
	});

	it('every MODE_BLIND_BY_DESIGN entry is a live one (no stale exemption)', () => {
		for (const token of Object.keys(MODE_BLIND_BY_DESIGN)) {
			expect(THEMED_TOKENS, `${token} is not a themed token`).toContain(token);
			expect(declaredValue(base, token), `${token} now differs per mode — drop its exemption`).toBe(
				declaredValue(light, token)
			);
		}
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
		// The value reader must distinguish two declarations of the same token.
		expect(declaredValue(base, '--color-bg')).not.toBe(declaredValue(light, '--color-bg'));
		expect(declaredValue(base, '--not-a-real-token')).toBeNull();
	});
});

describe('theme-token manifest ↔ consumer-guide § Theme tokens', () => {
	it('pins exactly the tokens the guide publishes', () => {
		expect(tokensInTable(themeTokenSection())).toEqual(
			[...THEMED_TOKENS, ...MODE_INDEPENDENT_TOKENS].sort()
		);
	});

	// Non-vacuity: an empty or over-wide slice would make the equality above prove
	// nothing (or couple it to unrelated prose).
	it('the section slice and row filter are non-vacuous', () => {
		const section = themeTokenSection();
		expect(section).not.toBe('');
		// `--syntax-heading` is named by the theming prose ABOVE the section — reaching
		// it would mean the slice has no upper bound.
		expect(tokensInTable(section)).not.toContain('--syntax-heading');
		expect(tokensInTable('| Role | `--in-table` |\nProse names `--in-prose`.')).toEqual([
			'--in-table'
		]);
	});
});
