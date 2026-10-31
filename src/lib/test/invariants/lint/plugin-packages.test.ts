/**
 * Each bundled plugin is a package an outside author could have written (G4.277): it imports only
 * the core's authoring entry points and the packages it declares as peers, ships in lockstep with
 * the core, declares every module with a side effect and publishes its conformance suite. A `#lib`
 * reach-in can't resolve from a package at all; this scan holds the rest.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	PLUGIN_KEYWORD,
	pluginPackages,
	publishedEntryPoints,
	workspacePackages
} from '../../../../../scripts/lib-alias.mjs';
import { collectEditorSources, importSpecifiers, type SourceFile } from './scan-source';

const ROOT = JSON.parse(readFileSync('package.json', 'utf8'));
const CORE: string = ROOT.name;

/** The core entry points a plugin's source may import; a test may add the kits. */
const AUTHORING_ENTRIES = [`${CORE}/plugin`, `${CORE}/svelte`];
const TEST_ENTRIES = [`${CORE}/testing`, 'vitest'];

interface PluginPackage {
	dir: string;
	manifest: Record<string, any>;
}

const isTestFile = (relPath: string) => /\.test\.ts$|\/test\//.test(relPath);

/** The published conformance suite, which may name the kits' types but load none of them. */
const CONFORMANCE_SOURCE = 'conformance.ts';

/** Why `specifier` may not appear in `relPath` of `pkg`, or null when it may. */
function boundaryProblem(
	pkg: PluginPackage,
	relPath: string,
	specifier: string,
	typeOnly = false
): string | null {
	const source = `${pkg.dir}/src`;
	if (specifier.startsWith('.')) {
		const target = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier));
		return target.startsWith(`${source}/`) ? null : 'a relative path out of its own source';
	}
	if (AUTHORING_ENTRIES.includes(specifier)) return null;
	if (isTestFile(relPath) && TEST_ENTRIES.includes(specifier)) return null;
	if (specifier === `${CORE}/testing` && path.posix.basename(relPath) === CONFORMANCE_SOURCE) {
		// The suite ships in the package, so the test kits must not ride into a host's install with it.
		return typeOnly ? null : 'the kits loaded at run time by a published module';
	}
	if (specifier === 'svelte' || specifier.startsWith('svelte/')) return null;
	if (specifier === CORE || specifier.startsWith(`${CORE}/`)) {
		return 'a core entry point other than /plugin and /svelte';
	}
	const peer = Object.keys(pkg.manifest.peerDependencies ?? {}).find(
		(name) => specifier === name || specifier.startsWith(`${name}/`)
	);
	if (peer === undefined) return 'a package it does not declare as a peer';
	// The rendering engine stays off the plugin's main entry, so a host that brings none loads none.
	return path.posix.basename(relPath) === 'renderer.ts' ? null : 'its engine outside renderer.ts';
}

/** Every way `pkg`'s manifest strays from the shape every plugin package shares. */
function manifestProblems(pkg: PluginPackage, rootVersion: string): string[] {
	const { manifest } = pkg;
	const problems: string[] = [];
	const say = (problem: string) => problems.push(`${manifest.name}: ${problem}`);
	if (manifest.name !== `${CORE}-${path.posix.basename(pkg.dir)}`)
		say('is not named after its directory');
	if (manifest.version !== rootVersion)
		say(`is at ${manifest.version}, the core at ${rootVersion}`);
	if (manifest.peerDependencies?.[CORE] !== rootVersion)
		say(`does not peer the core at ${rootVersion}`);
	const meta: Record<string, { optional?: boolean }> = manifest.peerDependenciesMeta ?? {};
	if (meta[CORE] !== undefined) say('makes the core an optional peer');
	for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
		if (peer !== CORE && meta[peer]?.optional !== true)
			say(`requires ${peer}, which a host may not have`);
	}
	if (manifest.peerDependencies?.svelte === undefined) say('does not peer svelte');
	if (manifest.dependencies?.[CORE] !== undefined) say('depends on the core, so a host gets two');
	if (manifest.repository?.directory !== pkg.dir) say('names another repository directory');
	if (manifest.license !== ROOT.license)
		say(`is licensed ${manifest.license}, not ${ROOT.license}`);
	if (manifest.publishConfig?.access !== 'public') say('would publish private');
	return problems;
}

/** Each module of `pkg` importing a stylesheet at its top level, as the two dist paths it builds to. */
function cssImportingBuilds(pkg: PluginPackage, files: SourceFile[]): string[] {
	return files
		.filter((file) => file.relPath.endsWith('.ts'))
		.filter((file) => /^\s*import\s+['"][^'"]+\.css['"]/m.test(file.code))
		.flatMap((file) => {
			const built = file.relPath.slice(`${pkg.dir}/src/`.length).replace(/\.ts$/, '.js');
			return [`./dist/${built}`, `./dist/prebuilt/${built}`];
		});
}

const hasStyles = (files: SourceFile[]) =>
	files.some((file) => file.relPath.endsWith('.svelte') && /<style[\s>]/.test(file.text));

// ── The scan ─────────────────────────────────────────────────────────────────

describe('G4.277 every bundled plugin is a package an outside author could have written', () => {
	const packages = pluginPackages();
	const sourcesOf = new Map(
		packages.map((pkg) => [
			pkg.dir,
			collectEditorSources(path.resolve(pkg.dir, 'src'), { includeTests: true })
		])
	);
	const filesOf = (pkg: PluginPackage) => sourcesOf.get(pkg.dir) ?? [];

	it('finds the bundled plugins, and every other workspace package is a framework wrapper', () => {
		expect(packages.length).toBeGreaterThan(1);
		const unlabelled = workspacePackages()
			.filter(({ manifest }) => !(manifest.keywords ?? []).includes(PLUGIN_KEYWORD))
			.filter(
				({ manifest }) => !manifest.peerDependencies?.react && !manifest.peerDependencies?.vue
			)
			.map(({ dir }) => dir);
		expect(
			unlabelled,
			`packages that are neither a wrapper nor marked "${PLUGIN_KEYWORD}"`
		).toEqual([]);
	});

	it('each manifest ships in lockstep with the core and peers it exactly', () => {
		expect(packages.flatMap((pkg) => manifestProblems(pkg, ROOT.version))).toEqual([]);
	});

	it('each published entry point builds from a source file the package holds', () => {
		const missing = packages.flatMap((pkg) =>
			publishedEntryPoints(pkg.manifest, `${pkg.dir}/src`)
				.filter(({ source }) => !existsSync(source))
				.map(({ subpath, source }) => `${pkg.manifest.name} ${subpath}: ${source}`)
		);
		expect(missing).toEqual([]);
	});

	it('each package publishes the conformance suite a plugin listing runs', () => {
		const missing = packages
			.filter((pkg) => !('./conformance' in (pkg.manifest.exports ?? {})))
			.map((pkg) => pkg.manifest.name);
		expect(missing).toEqual([]);
	});

	it('a package with component styles publishes its prebuilt stylesheet', () => {
		const wrong = packages
			.filter((pkg) => hasStyles(filesOf(pkg)) !== './style.css' in (pkg.manifest.exports ?? {}))
			.map((pkg) => pkg.manifest.name);
		expect(wrong).toEqual([]);
	});

	it('every module importing a stylesheet is declared side-effectful, in both builds', () => {
		const missing = packages.flatMap((pkg) =>
			cssImportingBuilds(pkg, filesOf(pkg))
				.filter((built) => !(pkg.manifest.sideEffects ?? []).includes(built))
				.map((built) => `${pkg.manifest.name}: ${built}`)
		);
		expect(missing).toEqual([]);
	});

	it('no source file imports past the authoring entry points or its declared peers', () => {
		const offenders = packages.flatMap((pkg) =>
			filesOf(pkg).flatMap((file) =>
				importSpecifiers(file.code)
					.map(({ specifier, typeOnly }) => ({
						specifier,
						problem: boundaryProblem(pkg, file.relPath, specifier, typeOnly)
					}))
					.filter(({ problem }) => problem !== null)
					.map(({ specifier, problem }) => `${file.relPath}: ${specifier} (${problem})`)
			)
		);
		expect(offenders).toEqual([]);
	});
});

// ── Classifier self-tests (non-vacuity) ──────────────────────────────────────

describe('G4.277 classifier non-vacuity', () => {
	const latex: PluginPackage = {
		dir: 'packages/latex',
		manifest: {
			name: `${CORE}-latex`,
			peerDependencies: { [CORE]: ROOT.version, katex: '^0.19.0', svelte: '^5.0.0' }
		}
	};
	const file = 'packages/latex/src/latex-kind.ts';

	it('allows the authoring entry points, svelte and its own files', () => {
		for (const specifier of [`${CORE}/plugin`, `${CORE}/svelte`, 'svelte', './math-shape']) {
			expect(boundaryProblem(latex, file, specifier), specifier).toBeNull();
		}
	});

	it('rejects the core root, a deep core path, a relative escape and an undeclared package', () => {
		for (const specifier of [
			CORE,
			`${CORE}/testing`,
			'#lib/core/parser.js',
			'../../../src/lib/core/parser',
			'../../mermaid/src/mermaid-kind',
			'lodash'
		]) {
			expect(boundaryProblem(latex, file, specifier), specifier).not.toBeNull();
		}
	});

	it('grants a declared engine to renderer.ts only, and the kits to tests only', () => {
		expect(
			boundaryProblem(latex, 'packages/latex/src/renderer.ts', 'katex/dist/katex.min.css')
		).toBeNull();
		expect(boundaryProblem(latex, file, 'katex')).not.toBeNull();
		expect(
			boundaryProblem(latex, 'packages/latex/test/kind.test.ts', `${CORE}/testing`)
		).toBeNull();
	});

	it('lets the conformance suite name the kits as types only', () => {
		const suite = 'packages/latex/src/conformance.ts';
		expect(boundaryProblem(latex, suite, `${CORE}/testing`, true)).toBeNull();
		expect(boundaryProblem(latex, suite, `${CORE}/testing`)).not.toBeNull();
		expect(boundaryProblem(latex, file, `${CORE}/testing`, true)).not.toBeNull();
	});

	it('flags a manifest out of step with the core or carrying the core as a dependency', () => {
		const drifted: PluginPackage = {
			dir: 'packages/latex',
			manifest: {
				...latex.manifest,
				version: '0.0.1',
				dependencies: { [CORE]: ROOT.version },
				peerDependenciesMeta: { katex: {} },
				repository: { directory: 'packages/latex' },
				license: ROOT.license,
				publishConfig: { access: 'public' }
			}
		};
		const problems = manifestProblems(drifted, ROOT.version).join('\n');
		expect(problems).toMatch(/is at 0\.0\.1/);
		expect(problems).toMatch(/depends on the core/);
		expect(problems).toMatch(/requires katex/);
	});

	it('flags a peer with no optional entry at all, which npm installs as required', () => {
		const problems = manifestProblems({ ...latex, manifest: { ...latex.manifest } }, ROOT.version);
		expect(problems.join('\n')).toMatch(/requires katex/);
		expect(problems.join('\n')).toMatch(/requires svelte/);
	});
});
