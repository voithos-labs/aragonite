/**
 * Fail-on-warn unit gate (Vitest setup). Every `devWarn` fire reds its owning test unless the
 * test claims it (`takeDevWarns` to assert on it, `expectDevWarns` for a fixture's incidental
 * fires) or the site is allowlisted for the whole run. Reads the structured sink, never a
 * console spy: most suites shadow `console.warn` and two call `vi.restoreAllMocks()`. Rows key
 * on tag + site, site being the first `src/lib` stack frame below the emission point.
 */

import { afterEach, expect } from 'vitest';
import { setDevWarnSink, type DevWarnEntry } from '$lib/dev-warn';
import { resetEditorEnv } from '$lib/env';
import { __resetCommandWarningsForTests } from '$lib/schema/commands';
import allowlist from './warn-allowlist.json';

export interface AllowedWarn {
	tag: string;
	site: string;
	reason: string;
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

/**
 * Drain, refusing any tag the caller did not declare. For a fixture that provokes a fire the
 * test is not about; declarations rot silently, which is the price of leaving the sharp
 * guards (`invariant:*`, `tree-ops`) out of the run-wide allowlist.
 */
export function expectDevWarns(tags: string[]): DevWarnRecord[] {
	const drained = takeDevWarns();
	const undeclared = drained.filter((record) => !tags.includes(record.tag));
	expect(undeclared, formatWarnFailure(undeclared)).toEqual([]);
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

export function formatWarnFailure(records: DevWarnRecord[]): string {
	const lines = records.map((r) => `  [${r.tag}] ${r.site} — ${r.message}`);
	return (
		`${records.length} unclaimed devWarn fire(s) in this test:\n${lines.join('\n')}\n` +
		'A guard that should never fire has fired: fix it. A test whose subject is the fire ' +
		'asserts on takeDevWarns(); a fixture that provokes one declares expectDevWarns([tag]); ' +
		'a cross-cutting benign diagnostic joins src/lib/test/support/warn-allowlist.json.'
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
const RELAYS = new Set(['src/lib/dev-warn.ts', 'src/lib/invariants/assert.ts']);

let recorded: DevWarnRecord[] = [];

setDevWarnSink((entry) => {
	recorded.push({ ...entry, site: siteFromStack(new Error().stack) });
});

afterEach(() => {
	const unclaimed = findUnallowlistedWarns(takeDevWarns());
	// The env singleton and the once-per-id warn set are process-global, so a leaked
	// override or a deduped warn would make the next test's verdict order-dependent.
	resetEditorEnv();
	__resetCommandWarningsForTests();
	if (unclaimed.length > 0) throw new Error(formatWarnFailure(unclaimed));
});
