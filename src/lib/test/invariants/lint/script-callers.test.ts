/**
 * G4.268: every file under `scripts/` has a caller, so a script nobody runs can't sit in the folder
 * looking maintained. A caller is an npm script, a workflow step, a git hook, an import or a
 * spawned path in another script, or an import from a root or package config or from `src/`. A
 * doc mention, a test that only reads the file, and a failure-message string are not callers: a
 * script reached only that way is hand-run, and sits in `HAND_RUN` with the reason.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describeFileRules, type FileRule } from './file-rule';
import { readSource, sourceFile } from './scan-source';

/** A file that may call a script: its path, and its text with comments blanked when it is code. */
interface CallerFile {
	relPath: string;
	text: string;
}

const git = (...args: string[]): string[] =>
	execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 120_000 })
		.split('\n')
		.filter((line) => line !== '' && existsSync(line));

/** Tracked and new files, never a gitignored one (a generated `.d.mts` isn't a script). */
const listed = (...pathspecs: string[]): string[] =>
	git('ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspecs);

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*(['"])(\.{1,2}\/[^'"]+)\1/g;

// ── What counts as a call ────────────────────────────────────────────────────

/** Whether `caller` runs or loads `script` (a path from the repo root). */
function calls(caller: CallerFile, script: string): boolean {
	if (caller.relPath === script) return false;
	if (!/\.(?:[cm]?[jt]s|svelte)$/.test(caller.relPath))
		return withoutComments(caller.text).includes(script);
	const from = path.posix.dirname(caller.relPath);
	const imports = [...caller.text.matchAll(IMPORT_SPECIFIER)].some(
		(match) => path.posix.join(from, match[2]) === script
	);
	return imports || (caller.relPath.startsWith('scripts/') && spawns(caller.text, script));
}

/** A string that is a command or a path and nothing more: `node scripts/x.mjs`, or the path alone.
 *  A sibling data file is named by its bare file name, since a script reads it from its own folder. */
function spawns(code: string, script: string): boolean {
	return [...code.matchAll(STRING_LITERAL)].some((match) => {
		const target = match[2].replace(/^node\s+/, '').split(/\s/)[0];
		return (
			target === script || (script.endsWith('.json') && target === path.posix.basename(script))
		);
	});
}

/** A workflow or hook with its comment lines dropped, so a comment can't be a caller. */
const withoutComments = (text: string): string =>
	text
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n');

// ── The files that may call ──────────────────────────────────────────────────

const isCode = (relPath: string): boolean => /\.(?:[cm]?[jt]s|svelte)$/.test(relPath);

function callerFiles(): CallerFile[] {
	const manifests = listed(
		'package.json',
		'examples/*/package.json',
		'packages/*/package.json',
		'.github/workflows',
		'.githooks'
	).map((relPath) => ({
		relPath,
		text: readFileSync(relPath, 'utf8')
	}));
	const code = [
		...listed('scripts', ':(glob)*.config.*', ':(glob)packages/*/*.config.*'),
		...git('grep', '--untracked', '-l', '-e', 'scripts/', '--', 'src/**/*.ts', 'src/**/*.svelte')
	]
		.filter(isCode)
		.map((relPath) => ({ relPath, text: readSource(relPath).code }));
	return [...manifests, ...code];
}

const CALLERS = callerFiles();

// ── The rule ─────────────────────────────────────────────────────────────────

/** Scripts a person runs by hand: no npm script, workflow or import reaches them. */
const HAND_RUN: Record<string, string> = {
	'scripts/issues/audit-issues.mjs': 'a maintainer runs it before a release; rules.md names it',
	'scripts/ci/ci-time.mjs': 'a report of the last dev push, run by hand; testing.md names it',
	'scripts/vendor/extract-spec-examples.mjs': 'regenerates the CommonMark examples on a spec bump',
	'scripts/ci/refresh-shard-timings.mjs': 'release prep rewrites the shard table; its test says so',
	'scripts/docs/render-perf-chart.mjs': 'redraws the README charts after a perf re-bless',
	'scripts/release/apply-branch-protection.mjs': 'an admin runs it; a test only reads its text'
};

const isOrphan = (relPath: string): boolean => !CALLERS.some((caller) => calls(caller, relPath));

const RULE: FileRule = {
	id: 'G4.268 every file under scripts/ has a caller',
	matches: (file) => isOrphan(file.relPath),
	allowed: HAND_RUN,
	reason:
		'a script with no npm script, workflow, hook, import or spawn is dead weight: wire it in, delete it, or add it to HAND_RUN with the reason',
	reaches: ['scripts/lib-alias.mjs', 'scripts/pack/verify-pack.mjs'],
	atLeast: 30,
	hits: [{ relPath: 'scripts/new.mjs', code: 'export const x = 1;\n' }],
	misses: [
		{ relPath: 'scripts/lib-alias.mjs', code: '' },
		{ relPath: 'scripts/pack/size-budget.json', code: '{}' }
	]
};

describeFileRules([RULE], listed('scripts').map(readSource));

// ── What a call is ───────────────────────────────────────────────────────────

describe('G4.268 what counts as a call', () => {
	const SCRIPT = 'scripts/pack/tool.mjs';
	const call = (relPath: string, text: string): boolean => calls({ relPath, text }, SCRIPT);
	const code = (relPath: string, text: string): boolean =>
		calls({ relPath, text: sourceFile(relPath, text).code }, SCRIPT);

	it('an npm script, a workflow step and a hook are calls', () => {
		expect(call('package.json', `"x": "node ${SCRIPT}"`)).toBe(true);
		expect(call('.github/workflows/ci.yml', `run: node ${SCRIPT}`)).toBe(true);
		expect(call('.githooks/commit-msg', `import('../${SCRIPT}')`)).toBe(true);
	});

	it('a script or a src file importing it is a call', () => {
		expect(code('scripts/pack/other.mjs', `import { a } from './tool.mjs';`)).toBe(true);
		expect(code('scripts/ci/other.mjs', `await import('../pack/tool.mjs');`)).toBe(true);
		expect(
			code('src/lib/test/x.test.ts', `import { a } from '../../../scripts/pack/tool.mjs';`)
		).toBe(true);
		expect(code('vite.config.js', `import { a } from './${SCRIPT}';`)).toBe(true);
	});

	it('a script spawning it by command or by path is a call', () => {
		expect(code('scripts/smoke/a.mjs', `run('node ${SCRIPT} --flag');`)).toBe(true);
		expect(code('scripts/issues/a.mjs', `path.join(ROOT, '${SCRIPT}')`)).toBe(true);
	});

	it('a failure message, a usage line and a comment are not calls', () => {
		expect(code('scripts/ci/a.mjs', `fail('ran outside ${SCRIPT}');`)).toBe(false);
		expect(code('scripts/ci/a.mjs', `fail('usage: node ${SCRIPT} <dir>');`)).toBe(false);
		expect(code('scripts/ci/a.mjs', `// run node ${SCRIPT} first\nconst a = 1;`)).toBe(false);
		expect(call('.github/workflows/ci.yml', `# runs ${SCRIPT}\nrun: echo`)).toBe(false);
	});

	it('a test reading the file, and the file itself, are not calls', () => {
		expect(code('src/lib/x.test.ts', `readFileSync(path.resolve('${SCRIPT}'), 'utf8');`)).toBe(
			false
		);
		expect(code(SCRIPT, `run('node ${SCRIPT}');`)).toBe(false);
	});
});
