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
			stripComments(collectEditorSources().map((f) => f.code).join('\n')) +
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
