#!/usr/bin/env node
// The numbers the lighter program reports: production lines, how many unit tests reach past the
// published API, and how many source scans are active. `--check` holds them to their budgets in
// `measure-baseline.json` (part of `npm run lint`); `--bless` records the current numbers there.
// `--at <ref>` measures a commit instead of the working tree; `--against <ref>` prints deltas.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { blessBudgets, checkBudgets, readBaseline } from './measure-baseline.mjs';
import { isTestPath, measureTests, moduleOf } from './measure-tests.mjs';

/** @typedef {import('./measure-tests.mjs').SourceTree} SourceTree */

const READ_PATHS = ['src/lib', 'docs/design/invariants/scans.md', 'package.json'];
const SCAN_CATALOG = 'docs/design/invariants/scans.md';

/**
 * Every measure over one tree.
 * @param {SourceTree} tree
 */
export function measureTree(tree) {
	const pkg = JSON.parse(tree.read('package.json'));
	return {
		lines: measureLines(tree),
		tests: measureTests(tree, pkg),
		scans: countScans(tree.read(SCAN_CATALOG))
	};
}

/** @typedef {ReturnType<typeof measureTree>} Measures */

/**
 * The numbers `--check` gates, by their row name in `measure-baseline.json`.
 * @param {Measures} measures
 * @returns {Record<string, number>}
 */
export function gatedRows(measures) {
	return {
		productionCodeLines: measures.lines.code,
		productionCommentLines: measures.lines.comment,
		unitTestsInternal: measures.tests.internal,
		unitTestsPublishedOnly: measures.tests.publishedOnly,
		activeSourceScans: measures.scans.active
	};
}

// ── Lines ────────────────────────────────────────────────────────────────────

/**
 * Non-blank code and comment lines of library production code (`.ts`, `.svelte` and `.js` under
 * `src/lib`, tests and declaration files aside), overall and per module.
 * @param {SourceTree} tree
 */
export function measureLines(tree) {
	const totals = { files: 0, code: 0, comment: 0 };
	/** @type {Record<string, { files: number, code: number, comment: number }>} */
	const byModule = {};
	for (const file of tree.files) {
		if (!isProduction(file)) continue;
		const { code, comment } = countLines(tree.read(file), file.endsWith('.svelte'));
		const module = (byModule[moduleOf(file)] ??= { files: 0, code: 0, comment: 0 });
		for (const sum of [totals, module]) {
			sum.files++;
			sum.code += code;
			sum.comment += comment;
		}
	}
	return { ...totals, byModule };
}

const isProduction = (/** @type {string} */ file) =>
	file.startsWith('src/lib/') &&
	/\.(ts|svelte|js)$/.test(file) &&
	!file.endsWith('.d.ts') &&
	!isTestPath(file);

/**
 * A line is a comment when it starts one or sits inside one; any other non-blank line is code.
 * A line of code with a trailing comment counts as code.
 * @param {string} text
 * @param {boolean} svelte Whether `<!-- -->` opens a comment too.
 */
export function countLines(text, svelte) {
	let code = 0;
	let comment = 0;
	/** @type {string | null} the closer of the comment the line sits in */
	let closer = null;
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line === '') continue;
		if (closer !== null) {
			comment++;
			if (line.includes(closer)) closer = null;
		} else if (line.startsWith('//')) {
			comment++;
		} else if (line.startsWith('/*')) {
			comment++;
			if (!line.slice(2).includes('*/')) closer = '*/';
		} else if (svelte && line.startsWith('<!--')) {
			comment++;
			if (!line.slice(4).includes('-->')) closer = '-->';
		} else {
			code++;
		}
	}
	return { code, comment };
}

// ── Scans ────────────────────────────────────────────────────────────────────

/**
 * The Group 4 catalog's rows, active and retired (a row whose rule reads `_Retired`).
 * @param {string} catalog
 */
export function countScans(catalog) {
	const rows = catalog.split('\n').filter((line) => /^\| G4\.\d+ /.test(line));
	const retired = rows.filter((line) => /^\| G4\.\d+ +\| _Retired/.test(line)).length;
	return { active: rows.length - retired, retired };
}

// ── Trees ────────────────────────────────────────────────────────────────────

/** The working tree: tracked files plus untracked ones git doesn't ignore. */
export function workingTree() {
	const listed = git(['ls-files', '-co', '--exclude-standard', '--', ...READ_PATHS]);
	return {
		files: listed.split('\n').filter((file) => file !== '' && existsSync(file)),
		read: (/** @type {string} */ file) => readFileSync(file, 'utf8')
	};
}

/**
 * A commit's tree, read from git's object store without checking anything out.
 * @param {string} ref
 * @returns {SourceTree}
 */
export function treeAt(ref) {
	const files = git(['ls-tree', '-r', '--name-only', ref, '--', ...READ_PATHS])
		.split('\n')
		.filter(Boolean);
	const output = execFileSync('git', ['cat-file', '--batch'], {
		input: files.map((file) => `${ref}:${file}`).join('\n') + '\n',
		maxBuffer: 1 << 30
	});
	/** @type {Map<string, string>} */
	const contents = new Map();
	let at = 0;
	for (const file of files) {
		const headerEnd = output.indexOf(10, at);
		const size = Number(output.subarray(at, headerEnd).toString().split(' ')[2]);
		contents.set(file, output.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8'));
		at = headerEnd + 1 + size + 1;
	}
	return {
		files,
		read: (file) => {
			const text = contents.get(file);
			if (text === undefined) throw new Error(`${file} is not in ${ref}`);
			return text;
		}
	};
}

/** @param {string[]} args */
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });

// ── Report ───────────────────────────────────────────────────────────────────

/**
 * @param {Measures} now
 * @param {Measures | null} base
 */
function report(now, base) {
	const delta = (/** @type {number} */ a, /** @type {number | undefined} */ b) =>
		b === undefined ? '' : ` (${a - b >= 0 ? '+' : ''}${a - b})`;
	const lines = [];
	const rows = gatedRows(now);
	const baseRows = base ? gatedRows(base) : null;
	lines.push('measure:');
	for (const [name, value] of Object.entries(rows)) {
		lines.push(
			`  ${name.padEnd(26)} ${String(value).padStart(7)}${delta(value, baseRows?.[name])}`
		);
	}
	lines.push(
		`  unit test files ${now.tests.files}, ${now.tests.noLibraryImport} import nothing from the ` +
			`library; by their own imports alone ${now.tests.direct.internal} internal, ` +
			`${now.tests.direct.publishedOnly} published-only`
	);
	lines.push(
		'',
		'  module                       files    code comment  tests int/pub (own imports)'
	);
	const modules = new Set([
		...Object.keys(now.lines.byModule),
		...Object.keys(now.tests.byModule),
		...Object.keys(base?.lines.byModule ?? {})
	]);
	const byCode = [...modules].sort(
		(a, b) => (now.lines.byModule[b]?.code ?? 0) - (now.lines.byModule[a]?.code ?? 0)
	);
	for (const module of byCode) {
		const l = now.lines.byModule[module] ?? { files: 0, code: 0, comment: 0 };
		const t = now.tests.byModule[module];
		const bl = base?.lines.byModule[module];
		const bt = base?.tests.byModule[module];
		const tests = t
			? `${t.internal}${delta(t.internal, bt?.internal ?? (base ? 0 : undefined))}/` +
				`${t.publishedOnly} (${t.internalDirect}/${t.publishedOnlyDirect})`
			: '';
		lines.push(
			`  ${module.padEnd(28)} ${String(l.files).padStart(5)} ` +
				`${String(l.code).padStart(7)}${delta(l.code, bl?.code ?? (base ? 0 : undefined))} ` +
				`${String(l.comment).padStart(7)}  ${tests}`
		);
	}
	lines.push('', '  test helpers importing internals, by the unit test files reaching them:');
	for (const { helper, tests } of now.tests.helpersImportingInternals.slice(0, 10)) {
		lines.push(`  ${String(tests).padStart(6)}  ${helper}`);
	}
	return lines.join('\n');
}

// ── Command line ─────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const args = process.argv.slice(2);
	const valueOf = (/** @type {string} */ flag) => {
		const at = args.indexOf(flag);
		return at === -1 ? null : args[at + 1];
	};
	const at = valueOf('--at');
	const against = valueOf('--against');
	const now = measureTree(at ? treeAt(at) : workingTree());
	if (args.includes('--bless')) {
		blessBudgets(gatedRows(now));
		console.log('measure: blessed', JSON.stringify(gatedRows(now)));
	} else if (args.includes('--check')) {
		const failures = checkBudgets(gatedRows(now), readBaseline(), 'npm run measure:bless');
		if (failures.length > 0) {
			console.error(
				'measure: moved past its tolerance (docs/contributing/testing.md § Size budgets):\n  ' +
					failures.join('\n  ')
			);
			process.exit(1);
		}
	} else if (args.includes('--json')) {
		console.log(JSON.stringify(now, null, '\t'));
	} else {
		console.log(report(now, against ? measureTree(treeAt(against)) : null));
	}
}
