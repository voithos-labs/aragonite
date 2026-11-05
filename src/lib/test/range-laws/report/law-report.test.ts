// @vitest-environment jsdom
// The deep run behind `npm run test:laws:report`: many draws per law, every violation kept, grouped
// by law, shape, gesture and mode, each group shrunk to its smallest counterexample. Writes the list
// the redesign is sized from. `LAW_REPORT_LAWS` picks laws, so a run can go a few at a time.

import { afterEach, beforeAll, beforeEach, it } from 'vitest';
import fc from 'fast-check';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { LAW_SPECS, isLawLine, type LawSpec } from '../law-specs';
import { KNOWN_VIOLATIONS, knownClassOf } from '../known-failures';
import type { LawRun } from '../laws';

const OUT = process.env.LAW_REPORT ?? '';
const RUNS = Number(process.env.LAW_REPORT_RUNS ?? 120);
const SEED = Number(process.env.LAW_REPORT_SEED ?? 20261105);
const SHRINK_MS = Number(process.env.LAW_REPORT_SHRINK_MS ?? 30_000);
const PICKED = (process.env.LAW_REPORT_LAWS ?? '').split(',').filter(Boolean);

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

interface Group {
	key: string;
	count: number;
	issue: string;
	firstRun: number;
	example: { args: unknown; line: string; range: unknown };
	shrunk?: { args: unknown; line: string; range: unknown; interrupted: boolean };
}

interface LawResult {
	law: string;
	name: string;
	runs: number;
	violating: number;
	groups: Group[];
	/** Other laws' lines these runs also produced (the post-conditions), counted, not shrunk. */
	others: Record<string, number>;
	undetermined: Record<string, number>;
	declared: Record<string, number>;
}

const groupKey = (line: string) => line.slice(0, line.indexOf(': '));
const reasonOf = (text: string) => text.replace(/[{[].*$/, '').trim();

// `LAW_REPORT_LAWS=none` only rewrites the list from the stored runs, tagged by the current rows.
it.runIf(OUT && PICKED.includes('none'))('rewrites the list', () => {
	const store = `${OUT}.json`;
	const results: LawResult[] = JSON.parse(readFileSync(store, 'utf8'));
	for (const r of results)
		for (const g of r.groups) g.issue = knownClassOf(g.example.line)?.issue ?? 'new';
	writeFileSync(store, JSON.stringify(results, null, '	'));
	writeFileSync(OUT, renderReport(results));
});

for (const spec of LAW_SPECS) {
	it.runIf(OUT && (PICKED.length === 0 || PICKED.includes(spec.law)))(
		`${spec.law} ${spec.name}`,
		async () => writeLaw(await sweep(spec)),
		3_600_000
	);
}

async function sweep(spec: LawSpec): Promise<LawResult> {
	const groups = new Map<string, Group>();
	const others: Record<string, number> = {};
	const undetermined: Record<string, number> = {};
	const declared: Record<string, number> = {};
	let index = 0;
	let violating = 0;
	await fc.check(
		fc.asyncProperty(spec.arb, async (args) => {
			const run = await settled(spec, args);
			const own = run.lines.filter((line) => isLawLine(spec.law, line));
			if (own.length) violating++;
			for (const line of new Set(run.lines)) {
				const key = groupKey(line);
				if (!isLawLine(spec.law, line)) {
					others[key] = (others[key] ?? 0) + 1;
					continue;
				}
				const group = groups.get(key);
				if (group) group.count++;
				else
					groups.set(key, {
						key,
						count: 1,
						issue: knownClassOf(line)?.issue ?? 'new',
						firstRun: index,
						example: { args, line, range: run.range }
					});
			}
			for (const reason of run.undetermined)
				undetermined[reasonOf(reason)] = (undetermined[reasonOf(reason)] ?? 0) + 1;
			for (const name of run.declared) declared[name] = (declared[name] ?? 0) + 1;
			index++;
			return true;
		}),
		{ numRuns: RUNS, seed: SEED }
	);
	for (const group of groups.values()) {
		// A short document is already a readable counterexample.
		const [first] = group.example.args as [{ source?: string }];
		if ((first?.source?.length ?? 0) > 40) group.shrunk = await shrink(spec, group);
	}
	return {
		law: spec.law,
		name: spec.name,
		runs: RUNS,
		violating,
		groups: [...groups.values()],
		others,
		undetermined,
		declared
	};
}

/** A run, with whatever it left mounted torn down and its warnings taken. */
async function settled(spec: LawSpec, args: unknown): Promise<LawRun> {
	try {
		return await spec.run(args);
	} catch (error) {
		return {
			lines: [`${spec.law}.threw [?] run ?/?: ${String(error)}`],
			undetermined: [],
			declared: []
		};
	} finally {
		await destroyMountedEditors();
		takeDevWarns();
	}
}

/** Replays the group's first run and shrinks it while it still lands in the group. */
async function shrink(spec: LawSpec, group: Group): Promise<Group['shrunk']> {
	let last: Group['shrunk'];
	const result = await fc.check(
		fc.asyncProperty(spec.arb, async (args) => {
			const run = await settled(spec, args);
			const line = run.lines.find((l) => groupKey(l) === group.key);
			if (!line) return true;
			last = { args, line, range: run.range, interrupted: false };
			return false;
		}),
		{ seed: SEED, path: String(group.firstRun), numRuns: RUNS, interruptAfterTimeLimit: SHRINK_MS }
	);
	if (last && result.interrupted) last.interrupted = true;
	return last;
}

// ── The violation list ───────────────────────────────────────────────────────

/** Each law's results join earlier runs' in one JSON beside the list, and the list is rewritten
 *  from all of them, so laws run a few at a time still make one list. */
function writeLaw(result: LawResult): void {
	mkdirSync(dirname(OUT), { recursive: true });
	const store = `${OUT}.json`;
	const kept: LawResult[] = existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : [];
	const results = [...kept.filter((r) => r.law !== result.law), result].sort(
		(a, b) => Number(a.law.slice(1)) - Number(b.law.slice(1))
	);
	writeFileSync(store, JSON.stringify(results, null, '\t'));
	writeFileSync(OUT, renderReport(results));
}

const code = (value: unknown) =>
	'`' + (typeof value === 'string' ? value : JSON.stringify(value)).replace(/`/g, 'ˋ') + '`';

/** Each known-failures row and how many groups and draws it took in these runs. */
function knownTable(results: LawResult[]): string[] {
	const groups = results.flatMap((r) => r.groups);
	const rows = KNOWN_VIOLATIONS.map((row) => {
		const hit = groups.filter((g) => knownClassOf(g.example.line) === row);
		const draws = hit.reduce((n, g) => n + g.count, 0);
		return `| ${row.issue} | ${row.lane} | ${row.defect} | ${hit.length} | ${draws} |`;
	});
	return [
		'## Known classes',
		'',
		'| Issue | Lane | Defect | Groups | Draws |',
		'| --- | --- | --- | ---: | ---: |',
		...rows,
		''
	];
}

function renderReport(results: LawResult[]): string {
	const out: string[] = [
		'# Range-edit law violations',
		'',
		`Seed ${SEED}, ${RUNS} draws per law, jsdom through the mounted editor's event routes. A group is one law × shape × gesture × mode; its count is the draws that landed in it, and its counterexample is the first one shrunk while it stays in the group. Lines open \`L<law>[.<label>] [<shape>] <gesture> <mode>/<eol>\`.`,
		'',
		...knownTable(results),
		'## Counts',
		'',
		'| Law | Draws | Violating | Groups | Known | New | Undetermined |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
	];
	for (const r of results) {
		const known = r.groups.filter((g) => g.issue !== 'new').length;
		const undetermined = Object.values(r.undetermined).reduce((a, b) => a + b, 0);
		out.push(
			`| ${r.law} ${r.name} | ${r.runs} | ${r.violating} | ${r.groups.length} | ${known} | ${r.groups.length - known} | ${undetermined} |`
		);
	}
	for (const r of results) {
		out.push('', `## ${r.law}: ${r.name}`, '');
		if (Object.keys(r.declared).length) {
			out.push(
				`Declared exceptions hit: ${Object.entries(r.declared)
					.map(([k, v]) => `${k} ×${v}`)
					.join(', ')}.`,
				''
			);
		}
		if (Object.keys(r.undetermined).length) {
			out.push(
				`Undetermined: ${Object.entries(r.undetermined)
					.map(([k, v]) => `${k} ×${v}`)
					.join(', ')}.`,
				''
			);
		}
		if (r.groups.length === 0) out.push('No violations.', '');
		if (Object.keys(r.others).length) {
			out.push('Post-conditions these runs also broke (counted, shrunk under their own law):', '');
			for (const [key, count] of Object.entries(r.others)) out.push(`- ${code(key)} ×${count}`);
			out.push('');
		}
		for (const g of [...r.groups].sort((a, b) => b.count - a.count)) {
			const ex = g.shrunk ?? g.example;
			out.push(
				`### ${g.key} (×${g.count}, ${g.issue})`,
				'',
				`- shrunk${g.shrunk?.interrupted ? ' (interrupted)' : g.shrunk ? '' : ' (first draw, unshrunk)'}: ${code(ex.args)}`,
				`- range: ${code(ex.range ?? null)}`,
				`- ${code(ex.line.slice(ex.line.indexOf(': ') + 2))}`,
				''
			);
		}
	}
	return out.join('\n') + '\n';
}
