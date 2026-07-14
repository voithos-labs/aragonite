/**
 * G4.10 — plugin package/pack parity. Every directory under `src/lib/plugins/`
 * is a shippable subpath, so each must surface as a `./plugins/<name>` entry in
 * package.json `exports` AND as `dist/plugins/<name>/index.js` +
 * `dist/plugins/<name>/index.d.ts` in verify-pack's REQUIRED manifest. A plugin
 * dir born without both is silently unshippable — the funnel that would enforce
 * this at build time can't exist (the manifests are hand-maintained), so the
 * parity rule lives here.
 *
 * The mapping is subset, not equality: latex and mermaid legitimately publish an
 * extra `/renderer` engine-adapter subpath, so the manifests carry more entries
 * than there are plugin dirs. The guard only asserts every dir is reachable —
 * never that every manifest entry maps back to a dir.
 *
 * sideEffects soft sub-check: a plugin module with a top-level (non-Svelte) CSS
 * import — latex's `renderer.ts` pulling KaTeX's stylesheet — is tree-shake-unsafe
 * unless its dist path is listed in `sideEffects`, or a bundler drops the bare
 * import and every equation paints twice. Only that one detectable shape is
 * flagged; side-effectfulness in general is not inferred.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { collectEditorSources } from './scan-source';

const PLUGIN_SRC = path.resolve('src/lib/plugins');

interface PackageManifest {
	exports: Record<string, unknown>;
	sideEffects: string[];
}

function readPackage(): PackageManifest {
	const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
	return { exports: pkg.exports ?? {}, sideEffects: pkg.sideEffects ?? [] };
}

/** Bundled plugin directory names (README.md and other files are not dirs). */
function pluginDirs(): string[] {
	return readdirSync(PLUGIN_SRC, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
}

// verify-pack's REQUIRED is a static string-literal array; the only `dist/plugins`
// paths in the file live there, so a scan for the token is unambiguous.
const VERIFY_PACK_PLUGIN_PATH = /dist\/plugins\/[A-Za-z0-9._/-]+/g;

function verifyPackPluginPaths(): Set<string> {
	const text = readFileSync(path.resolve('scripts/verify-pack.mjs'), 'utf8');
	return new Set(text.match(VERIFY_PACK_PLUGIN_PATH) ?? []);
}

/** A top-level side-effect CSS import (`import 'x.css';`), the latex renderer shape. */
function hasTopLevelCssImport(code: string): boolean {
	return /^\s*import\s+['"][^'"]+\.css['"]/m.test(code);
}

/** The `sideEffects` entry a plugin module maps to, e.g. `renderer.ts` → `./dist/plugins/latex/renderer.js`. */
function distSideEffectPath(pluginName: string, moduleFile: string): string {
	return `./dist/plugins/${pluginName}/${moduleFile.replace(/\.ts$/, '.js')}`;
}

/** Non-`.svelte` plugin modules carrying a top-level CSS import, as `{ plugin, file }`. */
function cssImportingModules(): Array<{ plugin: string; file: string }> {
	return collectEditorSources(PLUGIN_SRC)
		.filter((f) => f.relPath.endsWith('.ts') && hasTopLevelCssImport(f.code))
		.map((f) => {
			const rel = f.relPath.slice('src/lib/plugins/'.length);
			const [plugin, ...rest] = rel.split('/');
			return { plugin, file: rest.join('/') };
		});
}

// ── Parity checkers (pure — driven by both the live scan and the self-tests) ──

function missingExports(names: string[], exportKeys: Set<string>): string[] {
	return names.filter((n) => !exportKeys.has(`./plugins/${n}`));
}

function missingVerifyPack(names: string[], distPaths: Set<string>): string[] {
	return names.filter(
		(n) =>
			!distPaths.has(`dist/plugins/${n}/index.js`) || !distPaths.has(`dist/plugins/${n}/index.d.ts`)
	);
}

function missingSideEffects(
	modules: Array<{ plugin: string; file: string }>,
	sideEffects: Set<string>
): string[] {
	return modules
		.filter((m) => !sideEffects.has(distSideEffectPath(m.plugin, m.file)))
		.map((m) => `${m.plugin}/${m.file}`);
}

// ── The parity scan ──────────────────────────────────────────────────────────

describe('G4.10 plugin package/pack parity', () => {
	const names = pluginDirs();
	const pkg = readPackage();
	const exportKeys = new Set(Object.keys(pkg.exports));
	const distPaths = verifyPackPluginPaths();
	const sideEffects = new Set(pkg.sideEffects);

	it('found bundled plugin directories to check', () => {
		expect(names.length).toBeGreaterThan(0);
	});

	it('every plugin dir is exported as ./plugins/<name>', () => {
		const missing = missingExports(names, exportKeys);
		expect(missing, `plugins absent from package.json exports: ${missing.join(', ')}`).toEqual([]);
	});

	it('every plugin dir is in verify-pack REQUIRED as index.js + index.d.ts', () => {
		const missing = missingVerifyPack(names, distPaths);
		expect(
			missing,
			`plugins absent (or half-listed) in scripts/verify-pack.mjs REQUIRED: ${missing.join(', ')}`
		).toEqual([]);
	});

	it('every CSS-importing plugin module is declared in package.json sideEffects', () => {
		const modules = cssImportingModules();
		const missing = missingSideEffects(modules, sideEffects);
		expect(
			missing,
			`side-effectful plugin modules (top-level CSS import) absent from sideEffects: ${missing.join(', ')}`
		).toEqual([]);
	});
});

// ── Non-vacuity: the manifests parsed to real, populated sets ─────────────────

describe('G4.10 plugin package/pack parity — non-vacuity', () => {
	const pkg = readPackage();

	it('parsed a real export surface, verify-pack manifest, and sideEffects list', () => {
		expect(Object.keys(pkg.exports).length).toBeGreaterThan(0);
		expect(pkg.sideEffects.length).toBeGreaterThan(0);
		expect(verifyPackPluginPaths().size).toBeGreaterThan(0);
	});

	it('a known plugin resolves through every list (the checks can actually fail)', () => {
		expect(new Set(Object.keys(pkg.exports)).has('./plugins/latex')).toBe(true);
		expect(verifyPackPluginPaths().has('dist/plugins/latex/index.js')).toBe(true);
		expect(new Set(pkg.sideEffects).has('./dist/plugins/latex/renderer.js')).toBe(true);
	});

	it('the CSS-import scan finds latex renderer.ts and nothing benign', () => {
		const modules = cssImportingModules();
		expect(modules).toContainEqual({ plugin: 'latex', file: 'renderer.ts' });
	});
});

// ── Matcher self-tests (synthetic positives + benign negatives) ───────────────

describe('G4.10 plugin package/pack parity — matcher self-tests', () => {
	it('a plugin dir absent from a manifest is flagged, present ones are not', () => {
		expect(missingExports(['ghost'], new Set(['./plugins/latex']))).toEqual(['ghost']);
		expect(missingExports(['latex'], new Set(['./plugins/latex']))).toEqual([]);
	});

	it('a half-listed plugin (index.js only) trips the verify-pack check', () => {
		const distPaths = new Set(['dist/plugins/toc/index.js']);
		expect(missingVerifyPack(['toc'], distPaths)).toEqual(['toc']);
		distPaths.add('dist/plugins/toc/index.d.ts');
		expect(missingVerifyPack(['toc'], distPaths)).toEqual([]);
	});

	it('the CSS-import detector flags a bare stylesheet import and ignores module imports', () => {
		expect(hasTopLevelCssImport("import 'katex/dist/katex.min.css';")).toBe(true);
		expect(hasTopLevelCssImport("import { render } from './math-renderer';")).toBe(false);
		expect(hasTopLevelCssImport('const s = \'@import "x.css"\';')).toBe(false);
	});

	it('maps a module file to its dist sideEffects path', () => {
		expect(distSideEffectPath('latex', 'renderer.ts')).toBe('./dist/plugins/latex/renderer.js');
	});
});
