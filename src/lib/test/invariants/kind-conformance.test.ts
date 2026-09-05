import { describe, it, expect, afterEach } from 'vitest';
import { ALL_BLOCK_KINDS, isBuiltinBlockKind } from '$lib/core/nodes';
import { getAllRegisteredKinds, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { checkCopyIsRawByteSlice, runKindConformance } from '$lib/testing';
import { BUILTIN_KIND_PROFILES } from './builtin-kind-profiles';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The kit drives executors with hand-built endpoints, skipping SelectionState normalization,
// which is exactly the false-cell shape it exercises.
afterEach(() =>
	allowDevWarns(['invariant:cross-block-endpoint-coordinates', 'collectCrossBlockText:startTable'])
);

// Swept over the descriptor registry, so registering a built-in kind ENROLLS it here —
// a new kind is auto-covered the moment it registers.
const builtinKinds = getAllRegisteredKinds().filter(isBuiltinBlockKind);
const fixturedKinds = builtinKinds.filter((k) => getBlockKindDescriptor(k).conformanceFixture);

// ── Enrollment sweep ─────────────────────────────────────────────────────────

describe.each(builtinKinds)('kind conformance — %s', (kind) => {
	it('every headless closure cell holds or is recorded', async () => {
		const report = await runKindConformance(kind, BUILTIN_KIND_PROFILES[kind]);
		expect(new Set(report.cells.map((c) => c.column))).toEqual(
			new Set(Object.keys(getBlockKindDescriptor(kind).closure))
		);
		for (const cell of report.cells) expect(cell.detail.length).toBeGreaterThan(0);
	});
});

// ── Lockstep: no dead profiles ───────────────────────────────────────────────

describe('kind conformance — registry lockstep', () => {
	// A kind added to the union but never registered (or the reverse) silently leaves the
	// enrollment sweep, so the two sets are pinned equal.
	it('sweeps exactly the full built-in kind set', () => {
		expect(new Set(builtinKinds)).toEqual(new Set(ALL_BLOCK_KINDS));
	});

	it('every kind profile maps to a registered built-in kind', () => {
		const stale = Object.keys(BUILTIN_KIND_PROFILES).filter(
			(k) => !builtinKinds.includes(k as (typeof builtinKinds)[number])
		);
		expect(stale, 'profiles with no matching registered kind').toEqual([]);
	});
});

// ── Green-cell guards ────────────────────────────────────────────────────────

describe('kind conformance — a fixtured kind produces green generic cells', () => {
	// Pinning `executed`, not merely "the run resolved": a mechanism that quietly becomes
	// `boundary` is an unexercised cell, and stays green under a resolve-only check.
	it.each(fixturedKinds)('%s executes round-trip, merge, and undo (not boundary)', async (kind) => {
		const report = await runKindConformance(kind, BUILTIN_KIND_PROFILES[kind]);
		const executed = (column: string) =>
			expect(report.cells.find((c) => c.column === column)?.status).toBe('executed');
		executed('roundTrip');
		executed('mergeBackspace');
		executed('undo');
	});

	// Reverting the declared mode to `inherit-default` with the profile intact makes this
	// THROW rather than silently downgrade — the mode-contradiction guard below.
	it('table clipboard executes its rectangular-copy mechanism', async () => {
		const report = await runKindConformance('table', BUILTIN_KIND_PROFILES.table);
		expect(report.cells.find((c) => c.column === 'clipboard')?.status).toBe('executed');
	});

	it('thematicBreak searchPaint executes the not-supported degradation', async () => {
		const report = await runKindConformance('thematicBreak');
		const cell = report.cells.find((c) => c.column === 'searchPaint');
		expect(cell?.mode).toBe('not-supported');
		expect(cell?.status).toBe('executed');
	});
});

// ── Regression: the table false-cell shape ───────────────────────────────────
// Miss-analysis: no executable cell exercised clipboard semantics, so a false
// "copy is a plain byte slice" claim round-tripped past every gate. The prose case
// proves the executor discriminates rather than always throwing.

describe('kind conformance — byte-slice clipboard executor is the false-cell guard', () => {
	it('throws for a table declared inherit-default (the shipped bug shape)', () => {
		const fixture = getBlockKindDescriptor('table').conformanceFixture!;
		expect(() => checkCopyIsRawByteSlice('table', fixture)).toThrow(/raw byte slice/);
	});

	it('passes for a prose leaf whose copy is a true byte slice', () => {
		const fixture = getBlockKindDescriptor('paragraph').conformanceFixture!;
		expect(() => checkCopyIsRawByteSlice('paragraph', fixture)).not.toThrow();
	});
});

// ── Regression: a profile check may only cover an `implemented` cell ──────────
// Miss-analysis: a profiled path that bypasses the declared mode runs `executed` whatever
// the cell claims, leaving a mode revert unverified and the suite green. Pinned for the
// whole class — any profiled cell reverted off `implemented`, not just table.clipboard.

describe('kind conformance — a profile check is refused on a non-implemented cell', () => {
	it('rejects a custom check declared over an inherit-default cell', async () => {
		// paragraph.clipboard is inherit-default, so a profile clipboard check contradicts
		// it — the same shape a reverted table.clipboard raises against its own profile.
		await expect(
			runKindConformance('paragraph', { cells: { clipboard: { check: () => {} } } })
		).rejects.toThrow(/custom check is only valid on an 'implemented' cell/);
	});
});
