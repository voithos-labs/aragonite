// Times the perf A/B probe (`src/lib/e2e/perf-ab/gestures.spec.ts`) on several git refs on one
// machine, alternating the refs round by round so the machine's own speed cancels out of the
// ratios. Each ref gets its own checkout, install, production build and port. The probe always
// runs from this checkout, so every ref is driven and timed by the same code.
//
//   node scripts/ci/perf-ab.mjs --rounds 6 v0.11.5 next fix/some-lane
//   node scripts/ci/perf-ab.mjs --rounds 1 --grep range- tip=.    (a ready checkout: no install)
//   node scripts/ci/perf-ab.mjs --table tmp/perf-ab/results.json    (print a saved run again)
//
// A ref is a tag, a sha, or a branch, read as `origin/<branch>` when no local one exists.
// `--grep` keeps the rows whose name matches. Prints one table, also appended to `--summary` when
// given, and saves the raw samples to `--results`. Exits non-zero when a ref, a round or a row
// measured nothing; a row a ref can't run ("not on this ref") is a result, not a failure.
import { spawn, spawnSync } from 'node:child_process';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = 'playwright.perf-ab.config.ts';
const SERVE_TIMEOUT_MS = 120_000;

/* ---- The table ---- */

const ms = (n) => n.toFixed(1);

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Each ref's rounds of one row: the round p50s it measured, and why a round couldn't run it. */
function roundsOf(run, ref, id) {
	const p50s = [];
	const absent = [];
	const missing = [];
	for (let round = 1; round <= run.rounds; round++) {
		const result = run.runs.find((r) => r.ref === ref.name && r.round === round)?.rows[id];
		if (result?.absent) absent.push(result.absent);
		else if (result?.samples?.length > 0 && result.p50Ms > 0) p50s.push(result.p50Ms);
		else missing.push(round);
	}
	return { p50s, absent, missing, median: p50s.length > 0 ? median(p50s) : undefined };
}

/** One table with a row per probe row and a column per ref, the rounds behind it, and every way
 *  the run measured nothing. `run` is what `--results` saves: `{ refs: [{ name, sha, error }],
 *  rounds, runs: [{ ref, round, error, rows: { [id]: { order, label, key, samples, p50Ms, p95Ms,
 *  change } or { order, label, key, absent } } }] }`. */
function abTable(run) {
	const failures = [];
	for (const ref of run.refs) if (ref.error) failures.push(`${ref.name}: ${ref.error}`);
	for (const r of run.runs) if (r.error) failures.push(`${r.ref} round ${r.round}: ${r.error}`);

	const rows = new Map();
	for (const r of run.runs) for (const [id, result] of Object.entries(r.rows)) rows.set(id, result);
	const ids = [...rows.keys()].sort((a, b) => rows.get(a).order - rows.get(b).order);
	if (ids.length === 0) failures.push('no ref measured anything');
	const refs = run.refs.filter((ref) => !ref.error);

	const of = new Map(
		refs.map((ref) => [ref.name, new Map(ids.map((id) => [id, roundsOf(run, ref, id)]))])
	);
	const cell = (ref, id) => {
		const own = of.get(ref.name).get(id);
		if (own.absent.length === run.rounds) return `not on this ref: ${own.absent[0]}`;
		if (own.absent.length > 0) failures.push(`${ref.name}: ${id} ran on some rounds only`);
		for (const round of own.missing) failures.push(`${ref.name} round ${round}: no ${id} samples`);
		if (own.median === undefined) return 'nothing measured';
		const parts = [`${ms(own.median)} ms`];
		const first = of.get(refs[0].name).get(id).median;
		if (ref !== refs[0] && first) parts.push(`${(own.median / first).toFixed(2)}x`);
		parts.push(
			`spread ${Math.round(((Math.max(...own.p50s) - Math.min(...own.p50s)) / own.median) * 100)}%`
		);
		const keys = rows.get(id).key.map((key) => of.get(ref.name).get(key)?.median);
		if (keys.length > 0 && keys.every((k) => k > 0)) {
			parts.push(`${(own.median / keys.reduce((a, b) => a + b, 0)).toFixed(2)}x key`);
		}
		return parts.join(', ');
	};

	const plural = run.rounds === 1 ? '' : 's';
	const named = refs.map((ref) => `\`${ref.name}\` (${ref.sha ?? 'a ready checkout'})`);
	const lines = [
		`## Perf A/B: ${run.rounds} round${plural}, refs alternating`,
		'',
		`Refs: ${named.join(', ')}.`,
		'',
		`| row | key | ${refs.map((ref) => ref.name).join(' | ')} |`,
		`|${' --- |'.repeat(refs.length + 2)}`
	];
	for (const id of ids) {
		const { label, key } = rows.get(id);
		const keyed = key.length > 0 ? key.join(' + ') : '';
		lines.push(`| ${id}: ${label} | ${keyed} | ${refs.map((ref) => cell(ref, id)).join(' | ')} |`);
	}
	lines.push(
		'',
		"Each cell is the median of the rounds' p50s, its ratio to the first ref's, the spread of " +
			"those p50s (highest less lowest, over the median), and its ratio to the same ref's key: " +
			'the plain key the row is ruled to cost the same as, summed when it is two.'
	);

	const roundHeads = Array.from({ length: run.rounds }, (_, i) => `round ${i + 1}`);
	lines.push('', '<details><summary>Every round</summary>', '');
	lines.push(`| row | ref | ${roundHeads.join(' | ')} |`, `|${' --- |'.repeat(run.rounds + 2)}`);
	for (const id of ids) {
		for (const ref of refs) {
			const cells = roundHeads.map((_, i) => {
				const result = run.runs.find((r) => r.ref === ref.name && r.round === i + 1)?.rows[id];
				if (result?.absent) return 'not on this ref';
				if (!(result?.p50Ms > 0)) return 'missing';
				const { blocks, bytes } = result.change;
				return `${ms(result.p50Ms)} / ${ms(result.p95Ms)} (${blocks} blocks, ${bytes} B)`;
			});
			lines.push(`| ${id} | ${ref.name} | ${cells.join(' | ')} |`);
		}
	}
	lines.push(
		'',
		'Each round cell is p50 / p95 in ms, and what the last sample changed: the top-level ' +
			'block count and the bytes of the blocks the row watches.',
		'',
		'</details>'
	);
	if (failures.length > 0)
		lines.push('', '**Measured nothing:**', ...failures.map((f) => `- ${f}`));
	return { markdown: lines.join('\n') + '\n', failures };
}

/* ---- Each ref's tree ---- */

function mustRun(command, args, options) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.status !== 0) {
		const why = result.error?.message ?? `exited ${result.status ?? result.signal}`;
		throw new Error(`${path.basename(command)} ${args.join(' ')}: ${why}`);
	}
	return result;
}

/** The commit `ref` names, short; a branch this clone has only on the remote reads as
 *  `origin/<ref>`. Throws on a ref neither names. */
function resolveRef(ref) {
	for (const name of [ref, `origin/${ref}`]) {
		const args = ['rev-parse', '--verify', '--quiet', '--short', `${name}^{commit}`];
		const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
		if (result.error) throw new Error(`git: ${result.error.message}`);
		if (result.status === 0) return result.stdout.trim();
	}
	throw new Error(`git has no commit for ${ref} or origin/${ref}`);
}

/** The directory of package `name` as Node resolves it from `dir`, the nearest `node_modules` up. */
function packageDir(dir, name) {
	for (let at = path.resolve(dir); ; at = path.dirname(at)) {
		const candidate = path.join(at, 'node_modules', name);
		if (existsSync(path.join(candidate, 'package.json'))) return candidate;
		if (path.dirname(at) === at) throw new Error(`no ${name} installed for ${dir}`);
	}
}

/** A file or directory name for a ref, which may hold a slash. */
const fileName = (ref) => ref.replace(/[^\w.-]+/g, '_');

/** Checks `sha` out into its own worktree under `work`. */
function checkout(name, sha, work) {
	const dir = path.join(work, 'refs', fileName(name));
	if (existsSync(dir)) throw new Error(`${dir} already exists; remove it or pass a fresh --work`);
	mustRun('git', ['worktree', 'add', '--detach', dir, sha], { cwd: ROOT });
	return dir;
}

/** Installs the ref's own lockfile. */
function install(dir) {
	mustRun('npm', ['ci', '--no-audit', '--no-fund'], {
		cwd: dir,
		shell: process.platform === 'win32'
	});
}

/** Builds the ref's production app. */
function build(dir) {
	// A fresh install has no generated tsconfig, which the root one extends.
	const kit = path.join(packageDir(dir, '@sveltejs/kit'), 'svelte-kit.js');
	mustRun(process.execPath, [kit, 'sync'], { cwd: dir });
	mustRun(process.execPath, [path.join(packageDir(dir, 'vite'), 'bin', 'vite.js'), 'build'], {
		cwd: dir
	});
}

/** Serves the ref's build on `port` and resolves once the editor route answers. */
async function serve(dir, port) {
	const vite = path.join(packageDir(dir, 'vite'), 'bin', 'vite.js');
	const server = spawn(
		process.execPath,
		[vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		{ cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] }
	);
	const deadline = Date.now() + SERVE_TIMEOUT_MS;
	while (Date.now() < deadline && server.exitCode === null) {
		const ok = await fetch(`http://127.0.0.1:${port}/test/editor`).then(
			(r) => r.ok,
			() => false
		);
		if (ok) return server;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	stop(server);
	throw new Error(`the preview on port ${port} never answered`);
}

/** Stops a preview and the processes it started, and nothing else. */
function stop(server) {
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/T', '/F', '/PID', String(server.pid)], { stdio: 'ignore' });
	} else server.kill();
}

/* ---- The probe ---- */

/** Playwright's arguments for the probe, `--grep` included when given. */
const probeArgs = (options, ...more) => [
	path.join(packageDir(ROOT, '@playwright/test'), 'cli.js'),
	'test',
	'--config',
	CONFIG,
	...(options.grep ? ['--grep', options.grep] : []),
	...more
];

/** Fails before any install when the probe doesn't load or `--grep` keeps no row. */
function listRows(options) {
	const listed = spawnSync(process.execPath, probeArgs(options, '--list'), {
		cwd: ROOT,
		encoding: 'utf8'
	});
	const total = Number(/Total: (\d+) tests?/.exec(listed.stdout)?.[1] ?? 0);
	if (listed.status !== 0 || total === 0) {
		throw new Error(`the probe lists no rows:\n${listed.stdout}${listed.stderr}`);
	}
}

/** One round of the probe against one ref's preview: what each row reported. */
function probe(ref, round, options) {
	const tag = `${fileName(ref.name)}-r${round}`;
	const results = path.join(options.work, 'results', tag);
	console.log(`\n== round ${round}: ${ref.name} ==`);
	const status = spawnSync(process.execPath, probeArgs(options), {
		cwd: ROOT,
		stdio: 'inherit',
		env: {
			...process.env,
			PERF_AB_URL: ref.url,
			PERF_AB_RESULTS: results,
			PERF_AB_OUTPUT_DIR: path.join(options.work, 'test-results', tag)
		}
	}).status;
	const rows = {};
	for (const file of existsSync(results) ? readdirSync(results) : []) {
		const result = JSON.parse(readFileSync(path.join(results, file), 'utf8'));
		rows[result.id] = result;
	}
	return {
		ref: ref.name,
		round,
		...(status !== 0 && { error: `playwright exited ${status}` }),
		rows
	};
}

/* ---- The command ---- */

function parseArgs(argv) {
	const options = { rounds: 4, port: 4510, work: path.join(ROOT, 'tmp', 'perf-ab'), refs: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = () => argv[++i] ?? '';
		if (arg === '--rounds') options.rounds = Number(value());
		else if (arg === '--port') options.port = Number(value());
		else if (arg === '--work') options.work = path.resolve(value());
		else if (arg === '--grep') options.grep = value();
		else if (arg === '--summary') options.summary = value();
		else if (arg === '--results') options.results = path.resolve(value());
		else if (arg === '--table') options.table = value();
		else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
		else {
			const [name, dir] = arg.split('=');
			options.refs.push(dir === undefined ? { name } : { name, dir: path.resolve(dir) });
		}
	}
	if (!(options.rounds >= 1)) throw new Error('--rounds takes a whole number of at least 1');
	if (!options.table && options.refs.length === 0) throw new Error('name at least one ref');
	return options;
}

function report(run, options) {
	const { markdown, failures } = abTable(run);
	console.log(`\n${markdown}`);
	if (options.summary) appendFileSync(options.summary, markdown);
	process.exitCode = failures.length > 0 ? 1 : 0;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.table) return report(JSON.parse(readFileSync(options.table, 'utf8')), options);

	listRows(options);
	const results = options.results ?? path.join(options.work, 'results.json');
	const run = { refs: [], rounds: options.rounds, grep: options.grep, runs: [] };
	const servers = [];
	const checkouts = [];
	try {
		// Every ref resolves before the first install, so a mistyped one fails in seconds.
		for (const { name, dir } of options.refs) {
			const ref = { name, dir };
			run.refs.push(ref);
			try {
				if (!dir) ref.sha = resolveRef(name);
			} catch (error) {
				ref.error = error.message;
			}
		}
		for (const [i, ref] of run.refs.entries()) {
			if (ref.error) continue;
			try {
				if (!ref.dir) {
					ref.dir = checkout(ref.name, ref.sha, options.work);
					checkouts.push(ref.dir);
					install(ref.dir);
				}
				ref.url = `http://127.0.0.1:${options.port + i}`;
				build(ref.dir);
				servers.push(await serve(ref.dir, options.port + i));
			} catch (error) {
				ref.error = error.message;
			}
		}
		for (let round = 1; round <= options.rounds; round++) {
			for (const ref of run.refs) if (!ref.error) run.runs.push(probe(ref, round, options));
		}
	} finally {
		for (const server of servers) stop(server);
		for (const dir of checkouts) {
			const removed = spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT });
			if (removed.status !== 0) console.warn(`git kept the worktree at ${dir}; remove it by hand`);
		}
		mkdirSync(path.dirname(results), { recursive: true });
		writeFileSync(results, JSON.stringify(run, null, 1) + '\n');
		report(run, options);
	}
}

await main();
