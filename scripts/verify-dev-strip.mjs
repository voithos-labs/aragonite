// A host's production build carries none of the editor's dev checks (G4.247) and no dev-only module
// (G4.265). Vite builds a page that imports the editor, through the Svelte build and the prebuilt
// one, in development and in production: every check tag the development build carries must be gone
// from the production one. The production page's first-load and total JS and its chunk count are
// budget rows in `measure-baseline.json`. Run by verify-pack.mjs after `npm run package`;
// `node scripts/verify-dev-strip.mjs [root] [--bless]`.
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build } from 'vite';
import { blessBudgets, checkBudgets, readBaseline } from './measure-baseline.mjs';
import { bytesBySource } from './source-map-owners.mjs';

/** Fewer reached tags than this means the page stopped reaching the editor, not that it's clean. */
const REACHED_FLOOR = 40;

/** The published files no production build may carry: the invariant checks and the tree dump. */
const DEV_ONLY_MODULE = /(^|\/)dist\/(invariants\/|debug\/dump-tree\.js$)/;

/** Fewer mapped editor modules than this means the source maps stopped naming them. */
const MAPPED_FLOOR = 300;

const CHECK_CALL = /\b(?:assertInvariant|devWarn)\(\s*(['"`])([^'"`$\\]+)\1/g;
const QUOTED = /(['"`])([^'"`$\\\n]+)\1/g;

/** What the reader runs to accept the page's new size. */
export const BLESS_COMMAND = 'node scripts/verify-dev-strip.mjs --bless';

/**
 * Every failure, as a message (an empty list means each production build is clean), and each
 * production page's gzipped size as its `measure-baseline.json` row.
 * @param {string} [root] The package root, holding package.json, src and dist.
 */
export async function verifyDevStrip(root = '.') {
	const tags = checkTags(path.join(root, 'src/lib'));
	const failures = [];
	/** @type {Record<string, number>} */
	const sizes = {};
	const page = mkdtempSync(path.join(tmpdir(), 'dev-strip-'));
	try {
		writePage(page, path.resolve(root));
		for (const route of /** @type {const} */ (['svelte', 'prebuilt'])) {
			const development = await buildPage(page, route, 'development');
			const production = await buildPage(page, route, 'production');
			const name = route === 'svelte' ? 'minimalAppSvelte' : 'minimalAppPrebuilt';
			sizes[`${name}FirstLoadGzip`] = production.firstLoadGzipped;
			sizes[`${name}TotalGzip`] = production.gzipped;
			sizes[`${name}Chunks`] = production.chunks;
			const reached = tags.filter((tag) => carries(development.code, tag));
			console.log(
				`verify-dev-strip: ${route} ${production.firstLoadGzipped} B gzipped at first load and ` +
					`${production.gzipped} B in all over ${production.chunks} chunks in production, ` +
					`${development.gzipped} B in development, ${reached.length} check tags reached`
			);
			if (reached.length < REACHED_FLOOR) {
				failures.push(
					`the ${route} development build reaches ${reached.length} check tags, under ${REACHED_FLOOR}: is the page still loading the editor?`
				);
			}
			const kept = reached.filter((tag) => carries(production.code, tag));
			if (kept.length > 0) {
				failures.push(
					`the ${route} production build still carries ${kept.length} dev checks, e.g. ${kept.slice(0, 5).join(', ')}`
				);
			}
			// The prebuilt page's maps name the prebuilt chunks, not the editor's modules.
			if (route === 'svelte') failures.push(...devOnlyModules(production.outDir));
		}
	} finally {
		rmSync(page, { recursive: true, force: true });
	}
	return { failures, sizes };
}

// ── The dev-only modules ─────────────────────────────────────────────────────

/**
 * A failure per dev-only module the production build still carries bytes of (G4.265).
 * @param {string} outDir
 */
function devOnlyModules(outDir) {
	const owned = [...bytesBySource(outDir)].filter(([source]) => source.includes('/dist/'));
	if (owned.length < MAPPED_FLOOR) {
		return [
			`the svelte production build maps ${owned.length} of the editor's modules, under ${MAPPED_FLOOR}: are its source maps still written?`
		];
	}
	return owned
		.filter(([source]) => DEV_ONLY_MODULE.test(source))
		.map(
			([source, bytes]) =>
				`the svelte production build carries ${bytes} B of ${source.slice(source.lastIndexOf('dist/'))}, a dev-only module: reach it only inside an \`assertInvariant\` check or behind \`devChecksOn\``
		);
}

// ── The tags ─────────────────────────────────────────────────────────────────

/**
 * The tag each `assertInvariant` and `devWarn` call names, keeping only a tag no other string in
 * the library spells, so finding it in a build means the check shipped.
 * @param {string} libDir
 * @returns {string[]}
 */
function checkTags(libDir) {
	/** @type {Map<string, number>} */
	const atCalls = new Map();
	/** @type {Map<string, number>} */
	const anywhere = new Map();
	for (const file of sourceFiles(libDir)) {
		const text = readFileSync(file, 'utf8');
		for (const [, , tag] of text.matchAll(CHECK_CALL))
			atCalls.set(tag, (atCalls.get(tag) ?? 0) + 1);
		for (const [, , value] of text.matchAll(QUOTED))
			anywhere.set(value, (anywhere.get(value) ?? 0) + 1);
	}
	return [...atCalls].filter(([tag, count]) => anywhere.get(tag) === count).map(([tag]) => tag);
}

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(ts|svelte)$/.test(entry.name))
		.map((entry) => path.join(entry.parentPath, entry.name))
		.filter((file) => !/(^|[\\/])(test|e2e)[\\/]/.test(path.relative(dir, file)));
}

/** @param {string} code @param {string} tag */
const carries = (code, tag) =>
	['"', "'", '`'].some((quote) => code.includes(`${quote}${tag}${quote}`));

// ── The page ─────────────────────────────────────────────────────────────────

/** A page importing the editor, with the package linked the way an install puts it. It imports
 *  `configureEditorEnv` too, so a bundler can't prove the switch stays off without the swap. */
function writePage(/** @type {string} */ page, /** @type {string} */ packageRoot) {
	const scope = path.join(page, 'node_modules/@voithos-labs');
	mkdirSync(scope, { recursive: true });
	symlinkSync(packageRoot, path.join(scope, 'aragonite'), 'junction');
	const html = '<!doctype html><script type="module" src="./main.js"></script>';
	const main = [
		"import { createEditor } from '@voithos-labs/aragonite';",
		"import { configureEditorEnv } from '@voithos-labs/aragonite/testing';",
		'window.editorApi = { createEditor, configureEditorEnv };'
	].join('\n');
	writeFileSync(path.join(page, 'index.html'), html);
	writeFileSync(path.join(page, 'main.js'), main);
	writeFileSync(path.join(page, 'package.json'), '{ "type": "module" }');
}

/**
 * The built page: its JS, the gzipped bytes of all of it and of what the entry loads before it runs
 * (itself and its static imports, from Vite's manifest), and its chunk count.
 * @param {string} page
 * @param {'svelte' | 'prebuilt'} route The Svelte plugin makes Vite resolve the `svelte` condition.
 * @param {'development' | 'production'} mode
 */
async function buildPage(page, route, mode) {
	const outDir = path.join(page, `out-${route}-${mode}`);
	const previous = process.env.NODE_ENV;
	// Vite picks the `development` or `production` export condition from NODE_ENV.
	process.env.NODE_ENV = mode;
	try {
		await build({
			root: page,
			configFile: false,
			logLevel: 'silent',
			mode,
			plugins: route === 'svelte' ? [svelte({ configFile: false })] : [],
			build: {
				outDir,
				emptyOutDir: true,
				minify: mode === 'production',
				manifest: true,
				// Maps for the module check, with no comment pointing at them, so the bytes don't move.
				sourcemap: mode === 'production' ? 'hidden' : false
			}
		});
	} finally {
		process.env.NODE_ENV = previous;
	}
	const scripts = readdirSync(outDir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
		.map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)));
	/** @type {Map<string, Buffer>} */
	const bytes = new Map(scripts.map((file) => [file, readFileSync(path.join(outDir, file))]));
	const gzipped = (/** @type {Iterable<string>} */ files) =>
		[...files].reduce((sum, file) => sum + gzipSync(bytes.get(file) ?? '', { level: 9 }).length, 0);
	return {
		outDir,
		code: [...bytes.values()].map((code) => code.toString('utf8')).join('\n'),
		gzipped: gzipped(bytes.keys()),
		firstLoadGzipped: gzipped(firstLoad(outDir)),
		chunks: scripts.length
	};
}

/**
 * The JS files the page's entry loads before it runs, itself included, as paths under `outDir`.
 * @param {string} outDir
 */
function firstLoad(outDir) {
	/** @type {Record<string, { file: string, isEntry?: boolean, imports?: string[] }>} */
	const manifest = JSON.parse(readFileSync(path.join(outDir, '.vite/manifest.json'), 'utf8'));
	const keys = new Set(Object.keys(manifest).filter((key) => manifest[key].isEntry));
	for (const key of keys) for (const next of manifest[key].imports ?? []) keys.add(next);
	return [...keys].map((key) => path.normalize(manifest[key].file));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const args = process.argv.slice(2);
	const { failures, sizes } = await verifyDevStrip(args.find((arg) => !arg.startsWith('--')));
	if (args.includes('--bless')) blessBudgets(sizes);
	else failures.push(...checkBudgets(sizes, readBaseline(), BLESS_COMMAND));
	if (failures.length > 0) {
		console.error('verify-dev-strip:\n  ' + failures.join('\n  '));
		process.exit(1);
	}
}
