/**
 * CSS token ownership for the bundled plugins and the dev fixtures, which css-ownership.test.ts
 * excludes. Every `var(--…)` a plugin reads resolves to a token editor-theme.css declares or one
 * the plugin declares itself; a read in neither set renders its inline fallback forever, out of
 * any theme's reach.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources, readSource } from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

const PLUGIN_ROOTS = [path.resolve(SOURCE_DIR.plugins), path.resolve(SOURCE_DIR.referencePlugins)];

/** Tokens a `var(--x)` read references, ignoring any inline fallback. */
function readsIn(code: string): string[] {
	return [...code.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]);
}

/** Custom-property declarations, disjoint from `var(--x)` reads. Both spellings a component
 *  has: the CSS one (`--x:`) and Svelte's markup directive (`style:--x=`). */
function declsIn(code: string): string[] {
	return [...code.matchAll(/(?:style:)?(--[a-z0-9-]+)\s*[:=]/g)].map((m) => m[1]);
}

function pluginComponentSources(): Array<{ rel: string; code: string }> {
	return PLUGIN_ROOTS.flatMap((root) => collectEditorSources(root))
		.filter((f) => f.relPath.endsWith('.svelte'))
		.map((f) => ({ rel: f.relPath, code: f.code }));
}

// ── Non-vacuity: the scan is actually wired to the plugin tree ────────────────
// The matcher self-tests prove the regexes work; this proves the scan reached the
// components, pinning one real read from each allow-set.

describe('plugin CSS ownership: the scan collected the plugin components', () => {
	it('sees the dogfood plugin components and their real token reads', () => {
		const sources = pluginComponentSources();
		expect(sources.length).toBeGreaterThan(0);
		const reads = new Set(sources.flatMap((f) => readsIn(f.code)));
		expect(reads.has('--font-editor')).toBe(true);
		expect(reads.has('--adm-accent')).toBe(true);
	});
});

// ── The ownership scan ───────────────────────────────────────────────────────

describe('plugin CSS ownership: every var() read resolves to a real token', () => {
	it('no read falls outside editor-theme.css and the plugin-local declarations', () => {
		const themeTokens = new Set(declsIn(readSource(SOURCE.themeTokens).code));
		const sources = pluginComponentSources();
		// Local declarations pool tree-wide, not per file: custom properties cascade from
		// ancestors.
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

describe('plugin CSS ownership: matcher non-vacuity', () => {
	it('readsIn extracts the token and drops the fallback', () => {
		expect(readsIn('color: var(--color-text-secondary, #aaa);')).toEqual([
			'--color-text-secondary'
		]);
	});

	it('declsIn captures a declaration but not the var() read on the same line', () => {
		expect(declsIn('--adm-accent: var(--adm-note);')).toEqual(['--adm-accent']);
	});

	it('declsIn captures the markup spelling of the same declaration', () => {
		expect(declsIn('<div style:--parrot-rows={FRAME_ROWS}>')).toEqual(['--parrot-rows']);
	});

	it('a read absent from both allow-sets is flagged dead', () => {
		const allowed = new Set(['--font-editor', '--adm-accent']);
		const read = readsIn('color: var(--color-text-secondary, #aaa);')[0];
		expect(allowed.has(read)).toBe(false);
	});
});
