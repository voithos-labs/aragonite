/**
 * Fail-on-warn unit gate (Vitest setup). Every `devWarn` fire and every Svelte runtime warning
 * reds its owning test unless the test claims it (`takeDevWarns` to assert on it, `drainDevWarns`
 * to discard it, `allowDevWarns` for a file's incidental tags) or the site is allowlisted for the
 * whole run. The claim doors are file-level `afterEach` hooks, so the config pins
 * `sequence.hooks: 'stack'` to order them first. A per-file `afterAll` closes the two holes a
 * per-test verdict cannot see: a declared tag that no longer fires, and a fire that outlived
 * every test.
 */

import { afterAll, afterEach, expect } from 'vitest';
import { tick } from 'svelte';
import { setDevWarnSink, type DevWarnEntry, type DevWarnSink } from '$lib/dev-warn';
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

/** Drain the fires recorded since the last drain. A test whose subject IS the fire asserts on these. */
export function takeDevWarns(): DevWarnRecord[] {
	const taken = recorded;
	recorded = [];
	return taken;
}

/** Discard the fires a fixture provoked, so the test asserts only on what follows them. */
export function drainDevWarns(): void {
	takeDevWarns();
}

/**
 * Drain, refusing any tag the caller did not declare. For a fixture that provokes a fire the
 * test is not about. Every declared tag must fire somewhere in the file, or the file's
 * `afterAll` aggregate names it stale.
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

/** For a fire nobody claimed at all: the reader has yet to pick a door. */
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

/** Frames that relay a fire rather than emit it; the interesting site sits below them. */
const RELAYS = new Set(['src/lib/dev-warn.ts', 'src/lib/assert.ts']);

let recorded: DevWarnRecord[] = [];

// Per file, because Vitest re-runs the setup files for each: the aggregate below reads a
// declaration against the tags this file actually warmed.
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

/** Svelte's runtime warnings print through `console.warn` and nowhere else, headed
 *  `%c[svelte] <code>`; they join the sink under a `svelte:` tag so one claim door covers both. */
const SVELTE_WARN = /\[svelte\]\s+([a-z0-9_]+)/;

const PRINT = Symbol.for('aragonite:warn-gate:print');

type WatchedWarn = typeof console.warn & { [PRINT]?: typeof console.warn };

function watchSvelteWarns(): void {
	// Vitest may hand a later file the console a previous one wrapped; unwrap first so the
	// watch reads THIS file's sink rather than chaining onto a dead module instance.
	const print = (console.warn as WatchedWarn)[PRINT] ?? console.warn;
	const watch: WatchedWarn = (...args: unknown[]) => {
		const code = SVELTE_WARN.exec(String(args[0]))?.[1];
		if (code === undefined) {
			print(...args);
			return;
		}
		gateSink({
			tag: `svelte:${code}`,
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

/** The per-test verdict, exported so the gate's own suite can drive it without a nested runner. */
export async function enforceWarnGate(): Promise<void> {
	// A guard may defer its own fire (`reportContestedClaim` awaits a tick before warning);
	// without this the fire lands on the NEXT test's verdict, or on no test at all.
	await tick();
	const unclaimed = findUnallowlistedWarns(takeDevWarns());
	// The env singleton and the once-per-id warn set are process-global, so a leaked
	// override or a deduped warn would make the next test's verdict order-dependent.
	resetEditorEnv();
	__resetCommandWarningsForTests();
	const stolen = setDevWarnSink(gateSink) !== gateSink;
	if (unclaimed.length > 0) throw new Error(formatWarnFailure(unclaimed));
	if (stolen) throw new Error(STOLEN_SINK);
}

/** The per-file aggregate: stale declarations, plus fires that outlived every test. */
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
