/**
 * The editor module owns its CSS (G4.6): app.css holds no editor-owned rules or tokens, every
 * editor-owned token read is declared in editor-theme.css (a resolved host color in editor.css
 * alone, an `@property` registration counting as its own), every radius read carries a fallback,
 * and no read falls outside the two families (an off-family typo like `--text-muted` can never be
 * declared).
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources, readSource } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

// ── Token families ────────────────────────────────────────────────────────────
// Editor-owned tokens vs consumer-provided host-chrome tokens. Every var() read in the
// editor must belong to exactly one family.
const OWNED_TOKEN =
	/^--(?:(?:syntax|code-tok|md|search-match|search-bar)-[a-z0-9-]+|selection-overlay-bg|reorder-scope-bg|vr-spacer-bg|menu-[a-z-]+|font-editor|font-code|font-ui|editor-font-size)$/;
const HOST_TOKEN = /^--(?:color|radius)-[a-z0-9-]+$/;
const ANY_READ = /var\(\s*(--[a-z0-9-]+)/g;

// Bundled plugins own private palettes, guarded by plugin-css-ownership.test.ts, so they skip
// the family check here but not the fallback and declaration checks.
const isPluginSource = (relPath: string): boolean => relPath.startsWith(SOURCE_DIR.plugins);

// Read and comment-stripped once: three checks below walk the same corpus.
const EDITOR_CSS_SURFACES: ReadonlyArray<{ rel: string; text: string }> = [
	...collectEditorSources().map((f) => ({ rel: f.relPath, text: f.code })),
	{ rel: SOURCE.editorCss, text: readSource(SOURCE.editorCss).code },
	{ rel: SOURCE.themeTokens, text: readSource(SOURCE.themeTokens).code }
];

// ── G4.6c: contract completeness ─────────────────────────────────────────────
// Every editor-owned token read anywhere in the editor is declared in editor-theme.css, except the
// resolved host colors, which editor.css declares so a replacement theme stylesheet keeps them.

const RESOLVED_HOST_COLOR = /^--md-(?:color-[a-z0-9-]+|page-text)$/;
const declares = (css: string, token: string) => new RegExp(`${token}\\s*:`).test(css);
// A property editor.css registers with `@property` carries its own initial value, and is layout the
// editor computes rather than a theme token.
const registers = (css: string, token: string) =>
	new RegExp(`@property\\s+${token}\\s*\\{`).test(css);

describe('G4.6 CSS ownership: every editor-owned token read is declared in its own file', () => {
	const read = new Set<string>();
	for (const m of EDITOR_CSS_SURFACES.map((f) => f.text)
		.join('\n')
		.matchAll(ANY_READ)) {
		if (OWNED_TOKEN.test(m[1])) read.add(m[1]);
	}
	const owned = [...read];
	const theme = readSource(SOURCE.themeTokens).code;
	const structural = readSource(SOURCE.editorCss).code;

	it('every owned token read has a declaration', () => {
		const missing = owned
			.filter((tok) => !registers(structural, tok))
			.filter((tok) =>
				RESOLVED_HOST_COLOR.test(tok) ? !declares(structural, tok) : !declares(theme, tok)
			);
		expect(missing, `tokens read but not declared where they belong: ${missing}`).toEqual([]);
	});

	it('editor-theme.css declares no resolved host color', () => {
		const misplaced = owned.filter((tok) => RESOLVED_HOST_COLOR.test(tok) && declares(theme, tok));
		expect(misplaced, `resolved host colors declared in the theme: ${misplaced}`).toEqual([]);
	});

	it('editor-theme.css declares no property editor.css registers', () => {
		const misplaced = owned.filter((tok) => registers(structural, tok) && declares(theme, tok));
		expect(misplaced, `registered layout properties in the theme: ${misplaced}`).toEqual([]);
	});

	it('the scan reaches the resolved host colors', () => {
		expect(owned).toEqual(expect.arrayContaining(['--md-color-border', '--md-page-text']));
	});
});

// ── G4.6a: app.css owns no editor rules or tokens ────────────────────────────
const EDITOR_MARKERS: RegExp[] = [
	/--syntax-[a-z]/,
	/--code-tok-[a-z]/,
	/--font-editor\b/,
	/\.code-tok-/,
	/\.md-[a-z]/,
	/\[data-painted-range\]/,
	/\.editor\b/
];

describe('G4.6 CSS ownership: app.css holds no editor-owned rules', () => {
	const appCss = readSource(SOURCE.appCss).code;
	for (const re of EDITOR_MARKERS) {
		it(`app.css contains no ${re}`, () => {
			expect(appCss).not.toMatch(re);
		});
	}
});

// ── G4.6b: every radius read carries a fallback ──────────────────────────────
// A radius the host leaves undeclared has no default inside the editor, so the read carries one.
// Host colors are exempt: editor-theme.css resolves every one of them inside the editor.
const RADIUS_READ_NO_FALLBACK = /var\(\s*--radius-[a-z0-9-]+\s*\)/;

describe('G4.6 CSS ownership: radius reads carry a fallback', () => {
	it('no radius var() read is missing a fallback', () => {
		const offenders = EDITOR_CSS_SURFACES.filter((f) => RADIUS_READ_NO_FALLBACK.test(f.text)).map(
			(f) => f.rel
		);
		expect(offenders, `radius reads missing a fallback in: ${offenders.join(', ')}`).toEqual([]);
	});
});

// ── G4.6: no off-family token reads ──────────────────────────────────────────
// A read outside both families is invisible to the guards above and can never be declared
// by the theme, so it renders its inline fallback forever.

describe('G4.6 CSS ownership: every token read belongs to a declared family', () => {
	it('no var() read falls outside the owned and host families', () => {
		const offenders: string[] = [];
		for (const f of EDITOR_CSS_SURFACES) {
			if (isPluginSource(f.rel)) continue;
			for (const m of f.text.matchAll(ANY_READ)) {
				if (!OWNED_TOKEN.test(m[1]) && !HOST_TOKEN.test(m[1])) {
					offenders.push(`${m[1]} in ${f.rel}`);
				}
			}
		}
		expect(offenders, `off-family token reads: ${offenders.join(', ')}`).toEqual([]);
	});
});

// ── G4.6d: host-chrome defaults sit behind the opt-in class alone ────────────
// A host-chrome default on `.editor` shadows what a themed host cascades from `:root`, except
// for host-family names no host vocabulary carries, which the editor supplies in both modes.

// The root's children re-expose the root's resolved value, the host's own where it has one.
const REEXPOSED = (name: string) => new RegExp(`^${name}\\s*:\\s*var\\(--md-${name.slice(2)}\\)$`);

const EDITOR_SUPPLIED_HOST_NAMED = new Set([
	'--color-bg-secondary',
	'--color-bg-elevated',
	'--color-bg-muted',
	'--color-text-muted',
	'--color-ui-faint'
]);

const HOST_CHROME_TOKENS = [
	'--color-surface',
	'--color-text-secondary',
	'--color-text-primary',
	'--color-border',
	'--color-ui-muted',
	'--color-ui-dulled',
	'--color-accent',
	'--color-selection',
	'--color-error',
	'--radius-ui',
	'--radius-surface'
];

function rulesIn(file: string): Array<{ selector: string; body: string }> {
	const css = readSource(file).code;
	return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
		selector: selector.trim(),
		body
	}));
}

const declarationsIn = (body: string) => [...body.matchAll(/(--[a-z0-9-]+)\s*:[^;]*/g)];

describe('G4.6 CSS ownership: editor-theme.css keeps host-chrome defaults off `.editor`', () => {
	it('no host-chrome token is declared in a rule that matches `.editor`', () => {
		const offenders: string[] = [];
		for (const { selector, body } of rulesIn(SOURCE.themeTokens)) {
			if (!selector.includes('.editor')) continue;
			for (const [, name] of declarationsIn(body)) {
				if (HOST_TOKEN.test(name) && !EDITOR_SUPPLIED_HOST_NAMED.has(name)) {
					offenders.push(`${name} under ${selector}`);
				}
			}
		}
		expect(offenders, `host-chrome defaults shadowing the consumer cascade: ${offenders}`).toEqual(
			[]
		);
	});

	it('editor.css declares a host token only on a root child, re-exposing the resolved one', () => {
		const offenders: string[] = [];
		const reexposed: string[] = [];
		for (const { selector, body } of rulesIn(SOURCE.editorCss)) {
			for (const [declaration, name] of declarationsIn(body)) {
				if (!HOST_TOKEN.test(name)) continue;
				if (selector.endsWith('> *') && REEXPOSED(name).test(declaration.trim())) {
					reexposed.push(name);
				} else offenders.push(`${name} under ${selector}`);
			}
		}
		expect(offenders, `host tokens declared in editor.css: ${offenders}`).toEqual([]);
		expect(reexposed).toContain('--color-bg');
	});

	it('the class-only level declares every host-chrome token', () => {
		const classOnly = rulesIn(SOURCE.themeTokens)
			.filter(({ selector }) => !selector.includes('.editor'))
			.map(({ body }) => body)
			.join('\n');
		const missing = HOST_CHROME_TOKENS.filter((token) => !declares(classOnly, token));
		expect(missing, `host-chrome tokens absent from the opt-in class: ${missing}`).toEqual([]);
	});

	it('every editor-supplied exemption is a live one (no stale entry)', () => {
		const editorTier = rulesIn(SOURCE.themeTokens)
			.filter(({ selector }) => selector.includes('.editor'))
			.map(({ body }) => body)
			.join('\n');
		for (const token of EDITOR_SUPPLIED_HOST_NAMED) {
			expect(declares(editorTier, token), `${token} no longer declared`).toBe(true);
		}
	});
});

// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────────
// Without these, a regex that silently stops matching lets every guard above pass on an
// empty match set.

describe('G4.6 CSS ownership: matcher non-vacuity', () => {
	it('ANY_READ + OWNED_TOKEN match a synthetic owned read and the completeness check flags it missing', () => {
		const reads = [...'var(--syntax-keyword)'.matchAll(new RegExp(ANY_READ.source, 'g'))].map(
			(m) => m[1]
		);
		expect(reads).toEqual(['--syntax-keyword']);
		expect(OWNED_TOKEN.test(reads[0])).toBe(true);

		const token = reads[0];
		const declared = `${token}: #c678dd;`;
		const undeclared = '--syntax-string: #98c379;';
		expect(new RegExp(`${token}\\s*:`).test(declared)).toBe(true);
		expect(new RegExp(`${token}\\s*:`).test(undeclared)).toBe(false);
	});

	it('RADIUS_READ_NO_FALLBACK flags a bare radius read but accepts one with a fallback', () => {
		expect(RADIUS_READ_NO_FALLBACK.test('var(--radius-ui)')).toBe(true);
		expect(RADIUS_READ_NO_FALLBACK.test('var(--radius-ui, 4px)')).toBe(false);
	});

	it('the re-expose exemption takes only the resolved name, never a literal', () => {
		expect(REEXPOSED('--color-bg').test('--color-bg: var(--md-color-bg)')).toBe(true);
		expect(REEXPOSED('--color-bg').test('--color-bg: #2c2c2a')).toBe(false);
		expect(REEXPOSED('--color-bg').test('--color-bg: var(--md-color-border)')).toBe(false);
	});

	it('the family split rejects an off-family token both guards would otherwise miss', () => {
		expect(OWNED_TOKEN.test('--text-muted')).toBe(false);
		expect(HOST_TOKEN.test('--text-muted')).toBe(false);
		expect(OWNED_TOKEN.test('--search-match-bg')).toBe(true);
		expect(HOST_TOKEN.test('--color-text-muted')).toBe(true);
	});
});
