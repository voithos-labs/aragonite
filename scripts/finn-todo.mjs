// Finn's checklist, rendered from the issues assigned to him and pushed back. Opt-in: nothing
// runs it for you, and the issues stay the ledger — only the two verbs below are synced.
// Usage: node scripts/finn-todo.mjs pull|push
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSIGNEE = 'finnrw';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODO_FILE = path.join(ROOT, 'TODO.md');
const UNGROUPED = 'no area';

const HEADER = [
	'<!--',
	'Generated from the issues assigned to Finn; edit, then `node scripts/finn-todo.mjs push`.',
	'For Finn specifically, who does not follow the issues convention. Thank you Finn.',
	'-->'
].join('\n');

// ── The file ────────────────────────────────────────────────────────────────

/** `- [x] #123 title`, where a line a person typed carries no number yet. */
const TODO_LINE = /^- \[([ xX])\] (?:#(\d+) )?(.*\S)\s*$/;

/**
 * @typedef {object} TodoLine
 * @property {boolean} checked
 * @property {number | null} number `null` for a line typed by hand.
 * @property {string} title
 */

/**
 * @typedef {object} TodoIssue
 * @property {number} number
 * @property {string} title
 * @property {{ name: string }[]} labels
 */

/**
 * @param {TodoIssue} issue
 * @returns {string}
 */
function areaOf(issue) {
	const area = issue.labels.find((label) => label.name.startsWith('area:'));
	return area ? area.name.slice('area:'.length).trim() : UNGROUPED;
}

/**
 * The whole file: one checklist line per issue, grouped by `area:` label.
 * @param {TodoIssue[]} issues
 * @returns {string}
 */
export function renderTodo(issues) {
	/** @type {Map<string, TodoIssue[]>} */
	const groups = new Map();
	for (const issue of issues) {
		const area = areaOf(issue);
		groups.set(area, [...(groups.get(area) ?? []), issue]);
	}
	const areas = [...groups.keys()].sort((a, b) =>
		a === UNGROUPED || b === UNGROUPED ? (a === UNGROUPED ? 1 : -1) : a.localeCompare(b)
	);
	const sections = areas.map((area) => {
		const lines = (groups.get(area) ?? [])
			.sort((a, b) => a.number - b.number)
			.map((issue) => `- [ ] #${issue.number} ${issue.title}`);
		return `## ${area}\n\n${lines.join('\n')}`;
	});
	return `${[HEADER, ...sections].join('\n\n')}\n`;
}

/**
 * Every checklist line the file holds; anything else in it is ignored.
 * @param {string} text
 * @returns {TodoLine[]}
 */
export function readTodoLines(text) {
	/** @type {TodoLine[]} */
	const lines = [];
	for (const line of text.split('\n')) {
		const parts = TODO_LINE.exec(line);
		if (!parts) continue;
		lines.push({
			checked: parts[1] !== ' ',
			number: parts[2] ? Number(parts[2]) : null,
			title: parts[3]
		});
	}
	return lines;
}

/**
 * The file with each named title's new issue number written into its line.
 * @param {string} text
 * @param {Map<string, number>} numbers Title to the issue just filed for it.
 * @returns {string}
 */
export function numberTodoLines(text, numbers) {
	return text
		.split('\n')
		.map((line) => {
			const parts = TODO_LINE.exec(line);
			if (!parts || parts[2]) return line;
			const number = numbers.get(parts[3]);
			return number === undefined ? line : `- [${parts[1]}] #${number} ${parts[3]}`;
		})
		.join('\n');
}

// ── The command ─────────────────────────────────────────────────────────────

// gh exits non-zero with its own message, which is the useful one; a stack trace here would
// only say that a subprocess failed.
/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
function run(command, args) {
	try {
		return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (failure) {
		const reason = /** @type {{ stderr?: string; message?: string }} */ (failure);
		console.error(String(reason.stderr ?? reason.message).trim());
		process.exit(1);
	}
}

function pull() {
	const issues = JSON.parse(
		run('gh', [
			'issue',
			'list',
			'--assignee',
			ASSIGNEE,
			'--state',
			'open',
			'--limit',
			'500',
			'--json',
			'number,title,labels'
		])
	);
	writeFileSync(TODO_FILE, renderTodo(issues));
	console.log(`${TODO_FILE}: ${issues.length} open`);
}

function push() {
	const text = readFileSync(TODO_FILE, 'utf8');
	/** @type {Map<string, number>} */
	const filed = new Map();
	for (const line of readTodoLines(text)) {
		let { number } = line;
		if (number === null) {
			const url = run('gh', [
				'issue',
				'create',
				'--title',
				line.title,
				'--body',
				'',
				'--assignee',
				ASSIGNEE
			]).trim();
			number = Number(url.slice(url.lastIndexOf('/') + 1));
			run('node', [path.join(ROOT, 'scripts/issue-type.mjs'), String(number), 'feature']);
			filed.set(line.title, number);
			console.log(`#${number} filed: ${line.title}`);
		}
		if (line.checked) {
			run('gh', ['issue', 'close', String(number), '--comment', 'closed from TODO.md']);
			console.log(`#${number} closed: ${line.title}`);
		}
	}
	if (filed.size > 0) writeFileSync(TODO_FILE, numberTodoLines(text, filed));
}

const [verb] = process.argv.slice(2);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (verb === 'pull') pull();
	else if (verb === 'push') push();
	else {
		console.error('usage: node scripts/finn-todo.mjs pull|push');
		process.exit(2);
	}
}
