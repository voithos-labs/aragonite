/**
 * Plugin CSS token ownership. Plugins own their own token palettes, so G4.6
 * (css-ownership.test.ts) excludes `src/lib/plugins` and this guard owns that
 * domain instead — for both the in-package bundled plugins (`src/lib/plugins`)
 * and the dev fixtures (`src/routes/test/plugins`). It exists because a dead
 * `--color-text-secondary` reference once survived in a dogfood plugin, reading
 * its inline fallback forever, unreachable by any theme override. Every `var(--…)`
 * a plugin component reads must resolve either to a token declared in
 * editor-theme.css (either theme block) or to a custom property the plugin
 * declares itself (admonitions owns its `--adm-*` palette). A read in neither
 * set is a dead token.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources, readEditorFile } from './scan-source';

const PLUGIN_ROOTS = [path.resolve('src/lib/plugins'), path.resolve('src/routes/test/plugins')];

/** Tokens a `var(--x)` read references, ignoring any inline fallback. */
function readsIn(code: string): string[] {
	return [...code.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]);
}

/** Custom-property declarations (`--x:`), disjoint from `var(--x)` reads. */
function declsIn(code: string): string[] {
	return [...code.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
}

function pluginComponentSources(): Array<{ rel: string; code: string }> {
	return PLUGIN_ROOTS.flatMap((root) => collectEditorSources(root))
		.filter((f) => f.relPath.endsWith('.svelte'))
		.map((f) => ({ rel: f.relPath, code: f.code }));
}

// ── Non-vacuity: the scan is actually wired to the plugin tree ────────────────
// The matcher self-tests below prove the regexes work; this proves the walk
// reached the components. A path/glob miss (or an unexpected dir skip) would let
// every assertion pass on an empty set — so pin a known real read from each of
// the two allow-sets (host token, locally-declared token).

describe('plugin CSS ownership — the scan collected the plugin components', () => {
	it('sees the dogfood plugin components and their real token reads', () => {
		const sources = pluginComponentSources();
		expect(sources.length).toBeGreaterThan(0);
		const reads = new Set(sources.flatMap((f) => readsIn(f.code)));
		expect(reads.has('--font-editor')).toBe(true);
		expect(reads.has('--adm-accent')).toBe(true);
	});
});

// ── The ownership scan ───────────────────────────────────────────────────────

describe('plugin CSS ownership — every var() read resolves to a real token', () => {
	it('no read falls outside editor-theme.css and the plugin-local declarations', () => {
		const themeTokens = new Set(declsIn(readEditorFile('styles/editor-theme.css').code));
		const sources = pluginComponentSources();
		// Local declarations pool across the whole plugin tree, not per file: custom
		// properties cascade from ancestors, so a read resolving to a property declared
		// in a sibling/parent component is legitimate — per-file scoping would be the
		// stricter but wrong approximation.
		const localTokens = new Set(sources.flatMap((f) => declsIn(f.code)));
		const allowed = new Set([...themeTokens, ...localTokens]);

		const offenders: string[] = [];
		for (const f of sources) {
			for (const token of readsIn(f.code)) {
				if (!allowed.has(token)) offenders.push(`${token} in ${f.rel}`);
			}
		}
		expect(
			offenders,
			`dead token reads (not declared in editor-theme.css or locally): ${offenders.join(', ')}`
		).toEqual([]);
	});
});

// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────────

describe('plugin CSS ownership — matcher non-vacuity', () => {
	it('readsIn extracts the token and drops the fallback', () => {
		expect(readsIn('color: var(--color-text-secondary, #aaa);')).toEqual([
			'--color-text-secondary'
		]);
	});

	it('declsIn captures a declaration but not the var() read on the same line', () => {
		expect(declsIn('--adm-accent: var(--adm-note);')).toEqual(['--adm-accent']);
	});

	it('a read absent from both allow-sets is flagged dead', () => {
		const allowed = new Set(['--font-editor', '--adm-accent']);
		const read = readsIn('color: var(--color-text-secondary, #aaa);')[0];
		expect(allowed.has(read)).toBe(false);
	});
});
