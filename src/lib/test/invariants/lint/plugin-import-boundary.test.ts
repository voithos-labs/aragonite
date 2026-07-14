/**
 * Bundled-plugin import boundary. Every `.ts`/`.svelte` file under
 * `src/lib/plugins/**` may import only from the public authoring barrel
 * (`$lib/plugin`), relative paths inside its own plugin directory, and
 * `svelte` / `svelte/*`. This is the dogfood proof that the barrel is complete:
 * a bundled plugin reaching into `$lib` deep paths or a sibling plugin means the
 * public surface is missing something — fix the barrel, not the import.
 *
 * One exception: a file named `renderer.ts` may import its declared rendering
 * engine (`katex` for `plugins/latex`, `mermaid` for `plugins/mermaid`) — the
 * engine-adapter split keeps the heavy dependency off the plugin's core. The latex
 * and mermaid adapters exercise it; every other file in each plugin stays engine-free.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources } from './scan-source';

const PLUGIN_ROOT = 'src/lib/plugins';

// The rendering engine each plugin's `renderer.ts` is allowed to reach, incl.
// subpaths (katex ships its CSS at `katex/dist/katex.min.css`).
const PLUGIN_ENGINES: Record<string, RegExp> = {
	latex: /^katex(\/.*)?$/,
	mermaid: /^mermaid(\/.*)?$/
};

// Line-anchored so a CSS `@import` in a <style> block (which lacks the leading
// `import` at column 0) can't read as a JS side-effect import. `[\s\S]*?` spans a
// multi-line named-import list up to its `from`.
const FROM_IMPORT = /^\s*(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;

function importSpecifiers(code: string): string[] {
	const specs: string[] = [];
	for (const source of [FROM_IMPORT, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]) {
		const re = new RegExp(source.source, source.flags);
		let match: RegExpExecArray | null;
		while ((match = re.exec(code)) !== null) specs.push(match[1]);
	}
	return specs;
}

function pluginOf(relPath: string): { name: string; dir: string } | null {
	if (!relPath.startsWith(`${PLUGIN_ROOT}/`)) return null;
	const name = relPath.slice(PLUGIN_ROOT.length + 1).split('/')[0];
	return name ? { name, dir: `${PLUGIN_ROOT}/${name}` } : null;
}

function isAllowedSpecifier(relPath: string, specifier: string): boolean {
	if (specifier === '$lib/plugin') return true;
	if (specifier === 'svelte' || specifier.startsWith('svelte/')) return true;

	const plugin = pluginOf(relPath);
	if (!plugin) return false;

	if (specifier.startsWith('.')) {
		const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier));
		return resolved === plugin.dir || resolved.startsWith(`${plugin.dir}/`);
	}

	if (path.posix.basename(relPath) === 'renderer.ts') {
		const engine = PLUGIN_ENGINES[plugin.name];
		if (engine?.test(specifier)) return true;
	}

	return false;
}

// ── The boundary scan ────────────────────────────────────────────────────────

describe('plugin import boundary — bundled plugins import only the public barrel', () => {
	const sources = collectEditorSources(path.resolve(PLUGIN_ROOT));

	it('collected the bundled plugin source files', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no file imports outside $lib/plugin, its own dir, svelte, or its declared engine', () => {
		const offenders: string[] = [];
		for (const file of sources) {
			for (const specifier of importSpecifiers(file.code)) {
				if (!isAllowedSpecifier(file.relPath, specifier)) {
					offenders.push(`${file.relPath}: ${specifier}`);
				}
			}
		}
		expect(
			offenders,
			`bundled plugin files reaching outside the boundary: ${offenders.join(', ')}`
		).toEqual([]);
	});
});

// ── Classifier self-tests (non-vacuity) ──────────────────────────────────────

describe('plugin import boundary — classifier non-vacuity', () => {
	const file = 'src/lib/plugins/details/register.ts';

	it('allows the public authoring barrel and svelte', () => {
		expect(isAllowedSpecifier(file, '$lib/plugin')).toBe(true);
		expect(isAllowedSpecifier(file, 'svelte')).toBe(true);
		expect(isAllowedSpecifier(file, 'svelte/store')).toBe(true);
	});

	it('rejects the main barrel and any deep $lib reach-in', () => {
		expect(isAllowedSpecifier(file, '$lib')).toBe(false);
		expect(isAllowedSpecifier(file, '$lib/core/parser')).toBe(false);
	});

	it('allows a relative import inside the plugin dir, rejects one that escapes it', () => {
		expect(isAllowedSpecifier(file, './details-kind')).toBe(true);
		expect(isAllowedSpecifier(file, './DetailsBlock.svelte')).toBe(true);
		expect(isAllowedSpecifier(file, '../callout/callout-kind')).toBe(false);
		expect(isAllowedSpecifier(file, '../../schema/plugin-install')).toBe(false);
	});

	it('grants the engine allowance only to renderer.ts of the declaring plugin', () => {
		expect(isAllowedSpecifier('src/lib/plugins/latex/renderer.ts', 'katex')).toBe(true);
		expect(
			isAllowedSpecifier('src/lib/plugins/latex/renderer.ts', 'katex/dist/katex.min.css')
		).toBe(true);
		expect(isAllowedSpecifier('src/lib/plugins/mermaid/renderer.ts', 'mermaid')).toBe(true);
		// Same engine, wrong file → denied.
		expect(isAllowedSpecifier('src/lib/plugins/latex/latex-kind.ts', 'katex')).toBe(false);
		// renderer.ts, wrong engine for its plugin → denied.
		expect(isAllowedSpecifier('src/lib/plugins/mermaid/renderer.ts', 'katex')).toBe(false);
	});
});

describe('plugin import boundary — specifier extraction', () => {
	it('extracts single-line, multi-line, side-effect, and dynamic specifiers', () => {
		const code = [
			"import { a } from '$lib/plugin';",
			'import {',
			'\tb,',
			'\tc',
			"} from './local';",
			"import 'katex/dist/katex.min.css';",
			"const m = await import('mermaid');"
		].join('\n');
		expect(importSpecifiers(code).sort()).toEqual(
			['$lib/plugin', './local', 'katex/dist/katex.min.css', 'mermaid'].sort()
		);
	});

	it('ignores a CSS @import in a style block', () => {
		expect(importSpecifiers("\t@import 'reset.css';")).toEqual([]);
	});
});
