#!/usr/bin/env node
// The behavior differential: records this checkout's behavior rows and lists every input whose
// bytes, caret, undo result or dev warnings differ from a base, exiting 1 when any does. The base
// is `--against <ref>` recorded in a temporary worktree (where the branch left `dev` by default),
// or a record file given as `--against <path>`. `--record <path>` writes this checkout's rows,
// `--from <path>` diffs a record instead of running the suites, `--json` prints the diff as JSON.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffRows, formatDiff, formatRows, parseRows } from './behavior-rows.mjs';
import {
	BehaviorError,
	RESULTS,
	baseRows,
	installOf,
	recordSuites,
	resolveAgainst
} from './behavior-base.mjs';

const REPORT_LIMIT = 20;

const args = process.argv.slice(2);
const valueOf = (/** @type {string} */ flag) => {
	const at = args.indexOf(flag);
	return at === -1 ? null : args[at + 1];
};

// Ctrl+C stops the running suites; staying alive lets the temporary worktree's removal run.
process.on('SIGINT', () => (process.exitCode = 130));

try {
	const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
	const base = resolveAgainst(valueOf('--against'), root);
	console.error(`behavior: base ${base.label}`);

	const started = Date.now();
	const baseText =
		'file' in base
			? readFileSync(base.file, 'utf8')
			: baseRows({ root, sha: base.sha, install: installOf(root) });
	const from = valueOf('--from');
	const tip = parseRows(from ? readFileSync(from, 'utf8') : recordSuites(root));
	const seconds = Math.round((Date.now() - started) / 1000);

	const record = valueOf('--record');
	if (record) writeFileSync(record, formatRows(tip));

	const diff = diffRows(parseRows(baseText), tip);
	if (args.includes('--json')) {
		console.log(JSON.stringify(diff, null, '\t'));
	} else {
		const label = `behavior against ${base.label}`;
		const results = join(root, RESULTS, 'diff.txt');
		mkdirSync(join(root, RESULTS), { recursive: true });
		writeFileSync(results, formatDiff(label, diff) + '\n');
		console.log(
			`${formatDiff(label, diff, REPORT_LIMIT)}\n(${seconds} s; full list in ${results})`
		);
	}
	if (diff.changed.length + diff.added.length + diff.removed.length > 0) process.exitCode ||= 1;
} catch (error) {
	if (!(error instanceof BehaviorError)) throw error;
	console.error(error.message);
	process.exitCode ||= 1;
}
