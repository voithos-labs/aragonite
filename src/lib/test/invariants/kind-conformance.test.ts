import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS, isBuiltinBlockKind } from '$lib/core/nodes';
import { getAllRegisteredKinds, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { checkCopyIsRawByteSlice, runKindConformance } from '$lib/testing';
import { BUILTIN_KIND_PROFILES } from './builtin-kind-profiles';

// The generic battery, swept over the descriptor registry: registering a built-in
// kind ENROLLS it here — a new kind is auto-covered the moment it registers, and a
// declared `conformanceFixture` must produce green headless cells.
const builtinKinds = getAllRegisteredKinds().filter(isBuiltinBlockKind);
const fixturedKinds = builtinKinds.filter((k) => getBlockKindDescriptor(k).conformanceFixture);

// ── Enrollment sweep ─────────────────────────────────────────────────────────

describe.each(builtinKinds)('kind conformance — %s', (kind) => {
	it('every headless closure cell holds or is recorded', async () => {
		const report = await runKindConformance(kind, BUILTIN_KIND_PROFILES[kind]);
		// One recorded cell per declared closure column — nothing silently dropped.
		expect(new Set(report.cells.map((c) => c.column))).toEqual(
			new Set(Object.keys(getBlockKindDescriptor(kind).closure))
		);
		for (const cell of report.cells) expect(cell.detail.length).toBeGreaterThan(0);
	});
});

// ── Lockstep: no dead profiles ───────────────────────────────────────────────

describe('kind conformance — registry lockstep', () => {
	// Every declared built-in kind is registered and therefore swept — a kind added
	// to the union but never registered (or the reverse) breaks enrollment here.
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
	// The headless mechanisms every fixtured built-in exercises. Pinning `executed`
	// (not merely "runKindConformance resolved") guards the silent-downgrade failure
	// this batch exists to kill: a mechanism that quietly becomes `boundary` — an
	// unexercised cell — stays green under a resolve-only check but fails here.
	it.each(fixturedKinds)('%s executes round-trip, merge, and undo (not boundary)', async (kind) => {
		const report = await runKindConformance(kind, BUILTIN_KIND_PROFILES[kind]);
		const executed = (column: string) =>
			expect(report.cells.find((c) => c.column === column)?.status).toBe('executed');
		executed('roundTrip');
		executed('mergeBackspace');
		executed('undo');
	});

	// table declares `clipboard: implemented`, so its cell EXECUTES the profile's
	// rect-copy check rather than sitting boundary. The runner refuses a profile
	// check on a non-`implemented` cell, so reverting the mode to `inherit-default`
	// (profile left intact — the 0.9.24 incident) makes this run THROW, not merely
	// downgrade — pinned by the mode-contradiction guard below.
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
// Miss-analysis: no executable cell ever exercised clipboard semantics, so
// `table.clipboard: inherit-default` — a false "copy is a plain byte slice" claim —
// round-tripped past every gate. The inherit-default clipboard executor is that
// missing guard: a partial cross-block copy that STARTS inside a table synthesizes
// a sub-table (via emitTablePortion), which is NOT the raw byte slice the mode
// promises, so the check throws. A plain prose leaf copies as a true slice and
// passes — proving the executor discriminates rather than always throwing.

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
// Miss-analysis: the batch first shipped with the profiled path bypassing the
// declared mode — a custom check ran as `executed` no matter what the cell declared.
// So reverting `table.clipboard` from `implemented` to `inherit-default` (the exact
// 0.9.24 incident) left the rect-copy check running and the suite green: the declared
// mode went unverified. No test bit — the review's mutation probe found the hole. The
// runner now refuses a custom check on any cell not declared `implemented`, so a mode
// revert with the profile intact throws. This standing test pins that guard for the
// whole CLASS — any profiled cell reverted off `implemented`, not just table.clipboard.

describe('kind conformance — a profile check is refused on a non-implemented cell', () => {
	it('rejects a custom check declared over an inherit-default cell', async () => {
		// paragraph.clipboard is inherit-default; a profile clipboard check contradicts
		// it — the same contradiction a reverted table.clipboard now raises against its
		// profile, without the sweep re-asserting each cell's mode.
		await expect(
			runKindConformance('paragraph', { cells: { clipboard: { check: () => {} } } })
		).rejects.toThrow(/custom check is only valid on an 'implemented' cell/);
	});
});
