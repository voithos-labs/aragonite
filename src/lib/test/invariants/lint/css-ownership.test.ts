/**
 * CSS-ownership guards (G4.6). The editor module owns its CSS: app.css holds no
 * editor-owned rules or tokens, every editor-owned token read is declared in
 * editor-theme.css, every host-token read carries a fallback so an extracted
 * editor renders with no host theme, and no read falls outside the two families
 * (an off-family typo like `--text-muted` can never be declared, so it would
 * silently render its fallback forever). See docs/design/invariants.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectEditorSources, readEditorFile, stripComments } from './scan-source';

function readRepo(rel: string): string {
	return readFileSync(path.resolve(rel), 'utf8');
}

function readEditorCss(rel: string): string {
	try {
		return stripComments(readEditorFile(rel).text);
	} catch {
		return '';
	}
}

// ── Token families ────────────────────────────────────────────────────────────
// Editor-owned tokens vs consumer-provided host-chrome tokens. Every var() read in the
// editor must belong to exactly one family.
const OWNED_TOKEN =
	/^--(?:(?:syntax|code-tok|md|search-match)-[a-z0-9-]+|selection-overlay-bg|reorder-scope-bg|vr-spacer-bg|font-editor|editor-font-size)$/;
const HOST_TOKEN = /^--(?:color|radius)-[a-z0-9-]+$/;
const ANY_READ = /var\(\s*(--[a-z0-9-]+)/g;

// Bundled plugins own private palettes, guarded by plugin-css-ownership.test.ts, so they
// are off-family here by design. The exclusion is scoped to family membership ALONE:
// plugins stay under the G4.6b/G4.6c guards.
const isPluginSource = (relPath: string): boolean => relPath.startsWith('src/lib/plugins/');

function editorCssSurfaces(): Array<{ rel: string; text: string }> {
	return [
		...collectEditorSources().map((f) => ({ rel: f.relPath, text: f.code })),
		{ rel: 'styles/editor.css', text: readEditorCss('styles/editor.css') },
		{ rel: 'styles/editor-theme.css', text: readEditorCss('styles/editor-theme.css') }
	];
}

// ── G4.6c: contract completeness ─────────────────────────────────────────────
// Every editor-owned token read anywhere in the editor is declared in editor-theme.css.

describe('G4.6 CSS ownership — editor-theme.css declares every editor-owned token read', () => {
	it('every owned token read has a declaration', () => {
		const theme = readEditorFile('styles/editor-theme.css').text;
		const haystack = editorCssSurfaces()
			.map((f) => f.text)
			.join('\n');

		const read = new Set<string>();
		for (const m of haystack.matchAll(ANY_READ)) {
			if (OWNED_TOKEN.test(m[1])) read.add(m[1]);
		}

		const missing = [...read].filter((tok) => !new RegExp(`${tok}\\s*:`).test(theme));
		expect(
			missing,
			`tokens read but not declared in editor-theme.css: ${missing.join(', ')}`
		).toEqual([]);
	});
});

// ── G4.6a: app.css owns no editor rules or tokens ────────────────────────────
const EDITOR_MARKERS: RegExp[] = [
	/--syntax-[a-z]/,
	/--code-tok-[a-z]/,
	/--font-editor\b/,
	/\.code-tok-/,
	/\.md-[a-z]/,
	/\[data-cross-block\]/,
	/\.editor\b/
];

describe('G4.6 CSS ownership — app.css holds no editor-owned rules', () => {
	const appCss = stripComments(readRepo('src/app.css'));
	for (const re of EDITOR_MARKERS) {
		it(`app.css contains no ${re}`, () => {
			expect(appCss).not.toMatch(re);
		});
	}
});

// ── G4.6b: every host-token read carries a fallback ──────────────────────────
// A consumer-provided token read without a fallback renders nothing in an extracted
// editor. Editor-owned reads are exempt, since editor-theme.css declares them.
const HOST_READ_NO_FALLBACK = /var\(\s*--(?:color|radius)-[a-z0-9-]+\s*\)/;

describe('G4.6 CSS ownership — host-token reads carry a fallback', () => {
	it('no host-token var() read is missing a fallback', () => {
		const files = [
			...collectEditorSources().map((f) => ({ rel: f.relPath, text: f.code })),
			{ rel: 'styles/editor.css', text: readEditorCss('styles/editor.css') }
		];
		const offenders = files.filter((f) => HOST_READ_NO_FALLBACK.test(f.text)).map((f) => f.rel);
		expect(offenders, `host-token reads missing a fallback in: ${offenders.join(', ')}`).toEqual(
			[]
		);
	});
});

// ── G4.6: no off-family token reads ──────────────────────────────────────────
// A read outside both families is invisible to the guards above and can never be declared
// by the theme, so it renders its inline fallback forever.

describe('G4.6 CSS ownership — every token read belongs to a declared family', () => {
	it('no var() read falls outside the owned and host families', () => {
		const offenders: string[] = [];
		for (const f of editorCssSurfaces()) {
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
// A host-chrome default declared on `.editor` shadows what a themed host cascades from
// `:root`, forcing every such consumer into bridge rules. The exception is host-family
// names a host vocabulary does not carry: the editor supplies those in both modes.

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

function themeRules(): Array<{ selector: string; body: string }> {
	const css = stripComments(readEditorFile('styles/editor-theme.css').text);
	return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
		selector: selector.trim(),
		body
	}));
}

describe('G4.6 CSS ownership — editor-theme.css keeps host-chrome defaults off `.editor`', () => {
	it('no host-chrome token is declared in a rule that matches `.editor`', () => {
		const offenders: string[] = [];
		for (const { selector, body } of themeRules()) {
			if (!selector.includes('.editor')) continue;
			for (const [, name] of body.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
				if (HOST_TOKEN.test(name) && !EDITOR_SUPPLIED_HOST_NAMED.has(name)) {
					offenders.push(`${name} under ${selector}`);
				}
			}
		}
		expect(offenders, `host-chrome defaults shadowing the consumer cascade: ${offenders}`).toEqual(
			[]
		);
	});

	it('the class-only tier declares every host-chrome token', () => {
		const classOnly = themeRules()
			.filter(({ selector }) => !selector.includes('.editor'))
			.map(({ body }) => body)
			.join('\n');
		const missing = HOST_CHROME_TOKENS.filter(
			(token) => !new RegExp(`${token}\\s*:`).test(classOnly)
		);
		expect(missing, `host-chrome tokens absent from the opt-in class: ${missing}`).toEqual([]);
	});

	it('every editor-supplied exemption is a live one (no stale entry)', () => {
		const editorTier = themeRules()
			.filter(({ selector }) => selector.includes('.editor'))
			.map(({ body }) => body)
			.join('\n');
		for (const token of EDITOR_SUPPLIED_HOST_NAMED) {
			expect(new RegExp(`${token}\\s*:`).test(editorTier), `${token} no longer declared`).toBe(
				true
			);
		}
	});
});

// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────────
// Without these, a regex that silently stops matching lets every guard above pass on an
// empty match set.

describe('G4.6 CSS ownership — matcher non-vacuity', () => {
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

	it('HOST_READ_NO_FALLBACK flags a bare host read but accepts one with a fallback', () => {
		expect(HOST_READ_NO_FALLBACK.test('var(--color-surface)')).toBe(true);
		expect(HOST_READ_NO_FALLBACK.test('var(--color-surface, #fff)')).toBe(false);
	});

	it('the family split rejects an off-family token both guards would otherwise miss', () => {
		expect(OWNED_TOKEN.test('--text-muted')).toBe(false);
		expect(HOST_TOKEN.test('--text-muted')).toBe(false);
		expect(OWNED_TOKEN.test('--search-match-bg')).toBe(true);
		expect(HOST_TOKEN.test('--color-text-muted')).toBe(true);
	});
});
