/**
 * CSS-ownership guards (G4.6). The editor module owns its CSS: app.css holds no
 * editor-owned rules or tokens, every editor-owned token read is declared in
 * editor-theme.css, and every host-token read carries a fallback so an extracted
 * editor renders with no host theme. See docs/design/editor/invariants.md and
 * docs/superpowers/specs/2026-06-14-css-ownership-migration-design.md.
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

// ── G4.6c: contract completeness ─────────────────────────────────────────────
// Every editor-owned token read anywhere in the editor is declared in editor-theme.css.
const OWNED_READ =
	/var\(\s*(--(?:syntax|code-tok|md)-[a-z0-9-]+|--selection-overlay-bg|--font-editor)\b/g;

describe('G4.6 CSS ownership — editor-theme.css declares every editor-owned token read', () => {
	it('every owned token read has a declaration', () => {
		const theme = readEditorFile('styles/editor-theme.css').text;
		const haystack =
			stripComments(
				collectEditorSources()
					.map((f) => f.code)
					.join('\n')
			) +
			'\n' +
			readEditorCss('styles/editor.css');

		const read = new Set<string>();
		for (const m of haystack.matchAll(OWNED_READ)) read.add(m[1]);

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
// Host tokens (--color-*, --radius-*) are consumer-provided; a read without a
// fallback renders nothing in an extracted editor. Editor-owned token reads are
// exempt (editor-theme.css declares them).
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

// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────────
// Without these, a regex that silently stops matching would let every guard
// above pass on an empty match set.

describe('G4.6 CSS ownership — matcher non-vacuity', () => {
	it('OWNED_READ matches a synthetic owned-token read and the completeness check flags it missing', () => {
		const owned = [...'var(--syntax-keyword)'.matchAll(new RegExp(OWNED_READ.source, 'g'))].map(
			(m) => m[1]
		);
		expect(owned).toEqual(['--syntax-keyword']);

		const token = owned[0];
		const declared = `${token}: #c678dd;`;
		const undeclared = '--syntax-string: #98c379;';
		expect(new RegExp(`${token}\\s*:`).test(declared)).toBe(true);
		expect(new RegExp(`${token}\\s*:`).test(undeclared)).toBe(false);
	});

	it('HOST_READ_NO_FALLBACK flags a bare host read but accepts one with a fallback', () => {
		expect(HOST_READ_NO_FALLBACK.test('var(--color-bg)')).toBe(true);
		expect(HOST_READ_NO_FALLBACK.test('var(--color-bg, #fff)')).toBe(false);
	});
});
