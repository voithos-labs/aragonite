/**
 * A doc that pastes a gate's output is quoting a live contract, and a fence is the one place
 * `check-codebase-map.mjs` deliberately cannot see. So every pasted `codebase-map:`, `docs-links:`
 * or `docs-pack:` line is matched against what the script actually prints, green run and failure
 * run alike. `…` and `...` are the elision markers the docs already use, and match anything;
 * everything else is literal, so a drifted count or a reworded suffix reds the run.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');

/** Gitignored working area; its pastes ship nowhere. */
const EXCLUDED_DIR = 'docs/superpowers';

const PREFIXES = ['codebase-map:', 'docs-links:', 'docs-pack:'];

// ── What the scripts print ───────────────────────────────────────────────────

/**
 * Both scripts read their corpus from the working directory, so a failure run is a temp tree
 * holding one doc that breaks the rule. Without it only the green half of each message set
 * would ever be compared.
 */
const FAILURE_CORPORA: Record<string, (dir: string) => void> = {
	'check-codebase-map.mjs': (dir) => {
		mkdirSync(path.join(dir, 'docs/design'), { recursive: true });
		mkdirSync(path.join(dir, 'docs/contributing'), { recursive: true });
		writeFileSync(path.join(dir, 'docs/design/a.md'), 'A seam at `src/lib/nope.ts`.\n');
	},
	'build-docs-pack.mjs': (dir) => {
		mkdirSync(path.join(dir, 'docs/guide'), { recursive: true });
		writeFileSync(path.join(dir, 'docs/guide/a.md'), 'See [nowhere](nowhere.md).\n');
	}
};

function run(script: string, cwd: string): string[] {
	// stderr is piped, not inherited: a failure run's output is this gate's input, not a fire.
	const options: ExecFileSyncOptionsWithStringEncoding = {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	};
	try {
		return execFileSync('node', [path.join(ROOT, 'scripts', script)], options).split('\n');
	} catch (err) {
		const failure = err as { stdout?: string; stderr?: string };
		return `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`.split('\n');
	}
}

function liveLines(): string[] {
	const lines: string[] = [];
	for (const script of Object.keys(FAILURE_CORPORA)) {
		lines.push(...run(script, ROOT));
		const scratch = mkdtempSync(path.join(tmpdir(), 'aragonite-gate-'));
		try {
			FAILURE_CORPORA[script](scratch);
			lines.push(...run(script, scratch));
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	}
	return lines.map((line) => line.trimEnd()).filter((line) => line !== '');
}

// ── What the docs paste ──────────────────────────────────────────────────────

function corpusDocs(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = path.relative(ROOT, full).split(path.sep).join('/');
		if (entry.isDirectory()) {
			if (rel !== EXCLUDED_DIR) corpusDocs(full, out);
		} else if (entry.name.endsWith('.md')) out.push(rel);
	}
	return out;
}

/** A pasted line is one whose first token is a gate's prefix; the indented detail lines under
 *  a failure head name example files no live run reproduces, so they stay prose. */
function pastedLines(rel: string): Array<{ rel: string; line: number; text: string }> {
	return readFileSync(path.join(ROOT, rel), 'utf8')
		.split('\n')
		.map((text, index) => ({ rel, line: index + 1, text: text.trimEnd() }))
		.filter((entry) => PREFIXES.some((prefix) => entry.text.startsWith(prefix)));
}

// ── npm's own echo ───────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
	name: string;
	version: string;
	scripts: Record<string, string>;
};

const RUN_LINE = /^\$ npm run \S+/;
const ECHO_LINE = /^> (.+)$/;
const BANNER = /^(\S+)@(\S+) (\S+)$/;

/** Fenced blocks, each as its own lines, so a markdown blockquote is never read as a transcript. */
function fences(text: string): string[][] {
	const blocks: string[][] = [];
	let open: string[] | null = null;
	for (const line of text.split('\n')) {
		if (/^\s*(```|~~~)/.test(line)) {
			if (open) blocks.push(open);
			open = open ? null : [];
			continue;
		}
		open?.push(line);
	}
	return blocks;
}

/**
 * An `npm run` transcript echoes what npm resolved, and both halves name package.json: the banner
 * carries the package version (which a release bumps) and the line under it is the script itself.
 */
function echoFailures(rel: string, text: string): string[] {
	const failures: string[] = [];
	const bodies = new Set(Object.values(pkg.scripts));
	for (const block of fences(text)) {
		if (!block.some((line) => RUN_LINE.test(line))) continue;
		for (const line of block) {
			const echo = ECHO_LINE.exec(line)?.[1];
			if (echo === undefined) continue;
			const banner = BANNER.exec(echo);
			if (banner === null) {
				// `npm run x -- args` echoes the script with the args appended, so a prefix counts.
				const known = [...bodies].some((body) => echo === body || echo.startsWith(`${body} `));
				if (!known) failures.push(`${rel}: > ${echo} — no package.json script is this`);
				continue;
			}
			const [, name, version, script] = banner;
			if (name !== pkg.name) failures.push(`${rel}: > ${echo} — the package is ${pkg.name}`);
			if (version !== '…' && version !== pkg.version) {
				failures.push(`${rel}: > ${echo} — the version is ${pkg.version}; elide it with \`…\``);
			}
			if (!(script in pkg.scripts)) failures.push(`${rel}: > ${echo} — no such script`);
		}
	}
	return failures;
}

// ── The comparison ───────────────────────────────────────────────────────────

/** The pasted line as a pattern: `…` and `...` stand for whatever the run prints there. */
export function elisionPattern(pasted: string): RegExp {
	const escaped = pasted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^${escaped.replace(/…|\\\.\\\.\\\./g, '.*')}$`);
}

const docs = [...corpusDocs(path.join(ROOT, 'docs')), 'README.md', 'CONTRIBUTING.md'];
const pasted = docs.flatMap(pastedLines);
const live = liveLines();

// ── The gate ─────────────────────────────────────────────────────────────────

describe('pasted gate output ↔ what the gate prints', () => {
	it('every npm transcript echoes the package and script package.json declares', () => {
		const stale = docs.flatMap((rel) =>
			echoFailures(rel, readFileSync(path.join(ROOT, rel), 'utf8'))
		);
		expect(stale, `stale npm transcripts: ${stale.join('; ')}`).toEqual([]);
	});

	it('every pasted line matches a line a live run produces', () => {
		const stale = pasted
			.filter((entry) => !live.some((actual) => elisionPattern(entry.text).test(actual)))
			.map((entry) => `${entry.rel}:${entry.line}  ${entry.text}`);
		expect(
			stale,
			`these pastes no longer match what the script prints — re-run it and copy the line, eliding a count with \`…\`: ${stale.join('\n  ')}`
		).toEqual([]);
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// A reader that finds no pastes, or a run that captures no output, lets the gate above pass
// on two empty sets.

describe('pasted gate output — self-tests', () => {
	it('reads a real corpus and finds a paste of every gate prefix', () => {
		expect(docs.length).toBeGreaterThan(20);
		expect(docs).not.toContain(`${EXCLUDED_DIR}/queue-2026-08-26.md`);
		for (const prefix of PREFIXES) {
			expect(
				pasted.filter((entry) => entry.text.startsWith(prefix)).length,
				`no doc pastes a ${prefix} line`
			).toBeGreaterThan(0);
		}
	});

	it('captures both the green and the failure half of each script', () => {
		expect(live.some((line) => /^codebase-map: \d+ references resolve/.test(line))).toBe(true);
		expect(live.some((line) => line.startsWith('codebase-map: unresolved references'))).toBe(true);
		expect(live.some((line) => /^docs-links: \d+ corpus docs/.test(line))).toBe(true);
		expect(live.some((line) => line.startsWith('docs-pack: dead pointers'))).toBe(true);
	});

	it('treats an elision as a wildcard and everything else as literal', () => {
		const pattern = elisionPattern('codebase-map: … references resolve (… naming a symbol)');
		expect(pattern.test('codebase-map: 371 references resolve (105 naming a symbol)')).toBe(true);
		expect(pattern.test('codebase-map: 371 refs resolve (105 naming a symbol)')).toBe(false);
		expect(elisionPattern('docs-pack: … (a.md, b.md, ...)').test('docs-pack: 6 (a.md, b.md)')).toBe(
			false
		);
		expect(
			elisionPattern('docs-pack: … (a.md, b.md, ...)').test('docs-pack: 6 (a.md, b.md, c.md)')
		).toBe(true);
	});

	it('reads the transcripts, and reds on a banner or body that drifted', () => {
		const transcripts = docs.filter((rel) =>
			fences(readFileSync(path.join(ROOT, rel), 'utf8')).some((block) =>
				block.some((line) => RUN_LINE.test(line))
			)
		);
		expect(transcripts.length).toBeGreaterThan(1);
		const fence = '```';
		const transcript = (...lines: string[]) => [fence, ...lines, fence].join('\n');
		// A console transcript that never ran npm must not be read as one.
		expect(echoFailures('x.md', transcript('> __test.dumpTree()'))).toEqual([]);
		expect(echoFailures('x.md', transcript('$ npm run check', `> ${pkg.scripts.check}`))).toEqual(
			[]
		);
		expect(
			echoFailures('x.md', transcript('$ npm run check', '> svelte-check --tsconfig ./nope.json'))
		).toHaveLength(1);
		expect(
			echoFailures('x.md', transcript('$ npm run check', `> ${pkg.name}@0.0.1 check`))
		).toHaveLength(1);
	});

	it('reds on a count that drifted rather than being elided', () => {
		const drifted = 'codebase-map: 1 references resolve (1 naming a symbol) across 1 files';
		expect(live.some((actual) => elisionPattern(drifted).test(actual))).toBe(false);
	});
});
