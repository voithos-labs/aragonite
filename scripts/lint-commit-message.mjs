#!/usr/bin/env node
// The one definition of the enforced commit-message shape, called by the `commit-msg` hook
// and by the CI step over a pull request's range. Line 1 is the whole summary because
// `git log --oneline` and every `%s` consumer JOIN a multi-line first paragraph into one
// line; per-change lines therefore sit in the body, after a blank line.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── The rule ────────────────────────────────────────────────────────────────

export const SUBJECT_LIMIT = 72;
const PROSE_LINE_LIMIT = 100;
const PROSE_BODY_LIMIT = 3;

/** Symbol, an optional lowercase scope, then text that does not open uppercase. */
const SUBJECT_PARTS = /^([-+~>!@]) (?:\(([^)]*)\) )?(\S.*)$/;
const SCOPE_CHARS = /^[a-z0-9,/-]+$/;
const CHANGE_LINE = /^[-+~>!@] /;

/** Shapes git or a bot writes, which no convention of ours governs. */
// `fixup!`/`squash!` never reach a pull request unsquashed; the CI door catches a leftover.
const EXEMPT = [/^Merge /, /^Revert "/, /^[Bb]ump /, /^build\(deps/, /^fixup! /, /^squash! /];

const ATTRIBUTION = [/^co-authored-by:/i, /^(?:🤖\s*)?generated with /i];

/**
 * @typedef {object} CommitMessageProblem
 * @property {string} rule
 * @property {number} line 1-based, over the message with git's comment lines removed.
 * @property {string} text The offending line.
 * @property {string} detail What the rule requires.
 */

/**
 * The message as git will store it: comments and the verbose diff dropped, edges trimmed.
 * @param {string} raw
 * @returns {string[]}
 */
function significantLines(raw) {
	const all = raw.replace(/\r\n/g, '\n').split('\n');
	const scissors = all.findIndex((line) => /^#\s*-{2,}\s*>8\s*-{2,}/.test(line));
	const lines = (scissors === -1 ? all : all.slice(0, scissors))
		.filter((line) => !line.startsWith('#'))
		.map((line) => line.replace(/\s+$/, ''));
	while (lines.length > 0 && lines[0] === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

// Prose starts lowercase; an identifier such as `G1.38`, `CST`, `WebKit` or `MeasurableChild`
// may open a subject, so only a single capitalized plain word is the shape to reject.
const CAPITALIZED_WORD = /^[A-Z][a-z]*(?![\w.])/;

/**
 * @param {string} text
 * @param {number} line
 * @returns {CommitMessageProblem[]}
 */
function subjectProblems(text, line) {
	/** @type {CommitMessageProblem[]} */
	const problems = [];
	const parts = SUBJECT_PARTS.exec(text);
	const scope = parts?.[2];
	if (
		!parts ||
		(scope !== undefined && !SCOPE_CHARS.test(scope)) ||
		CAPITALIZED_WORD.test(parts[3])
	) {
		problems.push({
			rule: 'subject-shape',
			line,
			text,
			detail: 'expected `<symbol> [(scope)] lowercase text`, symbol one of + - ~ > ! @'
		});
	}
	if (text.length > SUBJECT_LIMIT) {
		problems.push({
			rule: 'subject-too-long',
			line,
			text,
			detail: `${text.length} characters, limit ${SUBJECT_LIMIT}`
		});
	}
	if (text.endsWith('.')) {
		problems.push({ rule: 'subject-trailing-period', line, text, detail: 'drop the period' });
	}
	return problems;
}

/**
 * A body is either per-change lines (every line a subject) or prose (at most three lines).
 * @param {string[]} lines
 * @param {number} firstLine
 * @returns {CommitMessageProblem[]}
 */
function bodyProblems(lines, firstLine) {
	/** @type {CommitMessageProblem[]} */
	const problems = [];
	const filled = lines
		.map((text, offset) => ({ text, line: firstLine + offset }))
		.filter((entry) => entry.text !== '');
	for (const entry of filled) {
		const trailer = ATTRIBUTION.find((shape) => shape.test(entry.text));
		if (trailer) {
			problems.push({
				rule: 'attribution-trailer',
				line: entry.line,
				text: entry.text,
				detail: 'the git history is not a credits reel'
			});
		}
	}
	if (filled.length > 0 && filled.every((entry) => CHANGE_LINE.test(entry.text))) {
		for (const entry of filled) problems.push(...subjectProblems(entry.text, entry.line));
		return problems;
	}
	if (filled.length > PROSE_BODY_LIMIT) {
		problems.push({
			rule: 'body-too-many-lines',
			line: filled[0].line,
			text: filled[0].text,
			detail: `${filled.length} body lines, limit ${PROSE_BODY_LIMIT} unless every one is a change line`
		});
	}
	for (const entry of filled) {
		if (entry.text.length > PROSE_LINE_LIMIT) {
			problems.push({
				rule: 'body-line-too-long',
				line: entry.line,
				text: entry.text,
				detail: `${entry.text.length} characters, limit ${PROSE_LINE_LIMIT}`
			});
		}
	}
	return problems;
}

/**
 * Every way the message breaks the convention; empty means it passes.
 * @param {string} raw
 * @returns {CommitMessageProblem[]}
 */
export function commitMessageProblems(raw) {
	const lines = significantLines(raw);
	if (lines.length === 0) {
		return [
			{ rule: 'subject-missing', line: 1, text: '', detail: 'a commit needs a subject line' }
		];
	}
	const [subject, ...rest] = lines;
	if (EXEMPT.some((shape) => shape.test(subject))) return [];

	const problems = subjectProblems(subject, 1);
	if (rest.length === 0) return problems;
	if (rest[0] === '') return [...problems, ...bodyProblems(rest.slice(1), 3)];
	problems.push({
		rule: 'body-missing-blank-line',
		line: 2,
		text: rest[0],
		detail: 'a blank line separates the summary from the body, or `--oneline` joins them'
	});
	return [...problems, ...bodyProblems(rest, 2)];
}

// ── The command ─────────────────────────────────────────────────────────────

/**
 * @param {CommitMessageProblem[]} problems
 * @param {string} label
 */
function report(problems, label) {
	console.error(`commit message rejected${label ? ` (${label})` : ''}:`);
	for (const problem of problems) {
		console.error(`  line ${problem.line}  ${problem.rule}: ${problem.detail}`);
		console.error(`    ${problem.text}`);
	}
	console.error('  convention: docs/contributing/commit-conventions.md');
}

/**
 * The `commit-msg` hook's entry: validate one message file, reporting to stderr.
 * @param {string} filePath
 * @returns {boolean} Whether the message passes.
 */
export function checkMessageFile(filePath) {
	const problems = commitMessageProblems(readFileSync(filePath, 'utf8'));
	if (problems.length > 0) report(problems, '');
	return problems.length === 0;
}

/**
 * `hash\nmessage` records, NUL-separated so a multi-line message stays one record.
 * @param {string} range
 * @returns {[hash: string, message: string][]}
 */
function rangeMessages(range) {
	const log = execFileSync('git', ['log', '-z', '--format=%H%n%B', range], { encoding: 'utf8' });
	return log
		.split('\0')
		.filter((record) => record.trim() !== '')
		.map((record) => {
			const cut = record.indexOf('\n');
			return /** @type {[string, string]} */ ([record.slice(0, cut), record.slice(cut + 1)]);
		});
}

/** @returns {Promise<string>} */
function readStdin() {
	return new Promise((resolve, reject) => {
		let text = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => (text += chunk));
		process.stdin.on('end', () => resolve(text));
		process.stdin.on('error', reject);
	});
}

async function main() {
	const [first, second] = process.argv.slice(2);
	let failed = false;
	if (first === '--range') {
		if (!second) throw new Error('--range needs a revision range, e.g. --range origin/dev..HEAD');
		for (const [hash, message] of rangeMessages(second)) {
			const problems = commitMessageProblems(message);
			if (problems.length > 0) {
				report(problems, hash.slice(0, 9));
				failed = true;
			}
		}
	} else if (first) {
		failed = !checkMessageFile(first);
	} else {
		const problems = commitMessageProblems(await readStdin());
		if (problems.length > 0) {
			report(problems, '');
			failed = true;
		}
	}
	if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
