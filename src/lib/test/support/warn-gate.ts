/**
 * Vitest setup that fails a unit test on any `devWarn` or Svelte runtime warning it did not claim
 * (`takeDevWarns`, `drainDevWarns`, `allowDevWarns`) and that `warn-allowlist.json` does not list.
 * Claims run in file-level `afterEach` hooks, so the config's `sequence.hooks: 'stack'` runs them
 * before this verdict. A per-file `afterAll` also fails a declared tag that never fired and a
 * warning that arrived after the last test.
 */

import { afterAll, afterEach, expect } from 'vitest';
import { tick } from 'svelte';
import { setDevWarnSink, warnTagOfLine, type DevWarnEntry, type DevWarnSink } from '$lib/dev-warn';
import { resetEditorEnv } from '$lib/env';
import { __resetCommandWarningsForTests } from '$lib/schema/commands';
import allowlist from './warn-allowlist.json';

export interface AllowedWarn {
	tag: string;
	site: string;
	reason: string;
	/** The site builds its tag from a parameter, so freshness only asserts that it still warns. */
	callerSuppliedTag?: boolean;
}

export interface DevWarnRecord extends DevWarnEntry {
	site: string;
}

export const ALLOWED_WARNS: AllowedWarn[] = allowlist.allow;

export const UNKNOWN_SITE = '<unattributed>';

// ── Public API ───────────────────────────────────────────────────────────────

/** Drain the warnings recorded since the last drain. A test about a warning asserts on these. */
export function takeDevWarns(): DevWarnRecord[] {
	const taken = recorded;
	recorded = [];
	return taken;
}

/** Discard the warnings a fixture provoked, so the test asserts only on what follows them. */
export function drainDevWarns(): void {
	takeDevWarns();
}

/**
 * Drain, refusing any tag the caller did not declare. For a fixture that provokes a warning the
 * test is not about. Every declared tag has to fire somewhere in the file, or the file's
 * `afterAll` summary names it stale.
 */
export function allowDevWarns(tags: string[]): DevWarnRecord[] {
	for (const tag of tags) declaredTags.add(tag);
	const drained = takeDevWarns();
	const undeclared = drained.filter((record) => !tags.includes(record.tag));
	expect(undeclared, formatUndeclaredWarnFailure(tags, undeclared)).toEqual([]);
	return drained;
}

export function findUnallowlistedWarns(
	records: DevWarnRecord[],
	rows: AllowedWarn[] = ALLOWED_WARNS
): DevWarnRecord[] {
	return records.filter(
		(record) => !rows.some((row) => row.tag === record.tag && row.site === record.site)
	);
}

/** For a warning nobody claimed at all: the test has yet to choose how to handle it. */
export function formatWarnFailure(records: DevWarnRecord[]): string {
	return (
		`${records.length} unclaimed devWarn fire(s) in this test:\n${listRecords(records)}\n` +
		'A guard that should never fire has fired: fix it. A test whose subject is the fire ' +
		'asserts on takeDevWarns(); a fixture that provokes one declares allowDevWarns([tag]); ' +
		'a cross-cutting benign diagnostic joins src/lib/test/support/warn-allowlist.json.'
	);
}

/** For a file that already declared its tags: name the declared set beside what missed it. */
export function formatUndeclaredWarnFailure(declared: string[], records: DevWarnRecord[]): string {
	return (
		`declared [${declared.join(', ')}]; unclaimed fire(s):\n${listRecords(records)}\n` +
		'The declaration does not cover these tags: either the guard should not have fired, or ' +
		'the tag belongs in the allowDevWarns list.'
	);
}

/** Repo-relative emitting file from a captured stack, or `UNKNOWN_SITE`. */
export function siteFromStack(stack: string | undefined): string {
	for (const line of (stack ?? '').split('\n')) {
		const match = FRAME_SITE.exec(line);
		if (!match) continue;
		const site = match[1];
		if (RELAYS.has(site) || site.startsWith('src/lib/test/support/')) continue;
		return site;
	}
	return UNKNOWN_SITE;
}

// ── Internal ─────────────────────────────────────────────────────────────────

const FRAME_SITE = /\/(src\/lib\/[^\s:?]+\.(?:ts|svelte))(?:\?[^\s:]*)?:\d+:\d+/;

/** Frames that pass a warning along rather than emit it; the interesting file sits below them. */
const RELAYS = new Set(['src/lib/dev-warn.ts', 'src/lib/assert.ts']);

let recorded: DevWarnRecord[] = [];

// Per file, because Vitest re-runs the setup files for each one: the summary below checks a
// declaration against the tags this file actually fired.
const declaredTags = new Set<string>();
const firedTags = new Set<string>();

function listRecords(records: DevWarnRecord[]): string {
	return records.map((r) => `  [${r.tag}] ${r.site} — ${r.message}`).join('\n');
}

// ── The gate ─────────────────────────────────────────────────────────────────

const gateSink: DevWarnSink = (entry) => {
	firedTags.add(entry.tag);
	recorded.push({ ...entry, site: siteFromStack(new Error().stack) });
};

setDevWarnSink(gateSink);

// ── The Svelte runtime channel ───────────────────────────────────────────────

const PRINT = Symbol.for('aragonite:warn-gate:print');

type WatchedWarn = typeof console.warn & { [PRINT]?: typeof console.warn };

function watchSvelteWarns(): void {
	// Vitest may hand a later file the console a previous one wrapped, so unwrap first: otherwise
	// the watcher records into a dead module instance instead of this file's own store.
	const print = (console.warn as WatchedWarn)[PRINT] ?? console.warn;
	const watch: WatchedWarn = (...args: unknown[]) => {
		// Svelte's runtime warnings print through `console.warn` and nowhere else.
		const tag = warnTagOfLine(String(args[0]));
		if (tag === null || !tag.startsWith('svelte:')) {
			print(...args);
			return;
		}
		gateSink({
			tag,
			message: String(args[0]).replace(/%c/g, '').replace(/\n/g, ' ')
		});
	};
	watch[PRINT] = print;
	console.warn = watch;
}

watchSvelteWarns();

const STOLEN_SINK =
	'This test replaced the devWarn sink and never restored it, so the fail-on-warn gate was ' +
	'blind for the rest of it. Restore it in an afterEach; setDevWarnSink returns the sink it ' +
	'replaced. The gate has re-armed itself for the next test.';

/** The per-test check, exported so the gate's own suite can drive it without a nested runner. */
export async function enforceWarnGate(): Promise<void> {
	// A dev-mode check may defer its own warning (`reportContestedClaim` awaits a tick first);
	// without this the warning lands on the next test, or on no test at all.
	await tick();
	const unclaimed = findUnallowlistedWarns(takeDevWarns());
	// The environment singleton and the once-per-id warning set are process-global, so a leaked
	// override or a deduplicated warning would make the next test depend on run order.
	resetEditorEnv();
	__resetCommandWarningsForTests();
	const stolen = setDevWarnSink(gateSink) !== gateSink;
	if (unclaimed.length > 0) throw new Error(formatWarnFailure(unclaimed));
	if (stolen) throw new Error(STOLEN_SINK);
}

/** The per-file summary: stale declarations, plus warnings that outlived every test. */
export function auditWarnDeclarations(
	declared: Iterable<string>,
	fired: ReadonlySet<string>,
	late: DevWarnRecord[]
): string[] {
	const problems: string[] = [];
	const stale = [...declared].filter((tag) => !fired.has(tag));
	if (stale.length > 0) {
		problems.push(
			`allowDevWarns declared [${stale.join(', ')}], which never fired in this file. ` +
				'A waiver nothing warms is a hole: drop the tag, or fix the fixture that stopped ' +
				'provoking it.'
		);
	}
	if (late.length > 0) {
		problems.push(
			`${late.length} devWarn fire(s) arrived after the last test's verdict:\n${listRecords(late)}\n` +
				'Nothing could attribute them. A guard that defers past a tick is claimed by the ' +
				'test that provokes it (`await tick()` before `takeDevWarns()`), not by the file.'
		);
	}
	return problems;
}

afterEach(enforceWarnGate);

afterAll(async () => {
	await tick();
	const problems = auditWarnDeclarations(
		declaredTags,
		firedTags,
		findUnallowlistedWarns(takeDevWarns())
	);
	if (problems.length > 0) throw new Error(problems.join('\n\n'));
});
