import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS, isBuiltinBlockKind } from '#lib/core/nodes.js';
import {
	getAllRegisteredKinds,
	getBlockKindDescriptor
} from '#lib/schema/block-kind-descriptor.js';
import { checkCopyIsRawByteSlice, runKindConformance } from '#lib/testing.js';
import { KIND_CELL_CONTRACTS } from '#lib/testing/cell-contracts.js';
import { BUILTIN_KIND_PROFILES } from './builtin-kind-profiles';
import type { PluginBlockKind } from '#lib/core/nodes.js';
import { OPENER_PRIORITIES } from '#lib/schema/opener-priorities.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

// Swept over the descriptor registry, so registering a built-in kind enrolls it here:
// a new kind is auto-covered the moment it registers.
const builtinKinds = getAllRegisteredKinds().filter(isBuiltinBlockKind);
const fixturedKinds = builtinKinds.filter((k) => getBlockKindDescriptor(k).conformanceFixture);

// ── Enrollment sweep ─────────────────────────────────────────────────────────

describe.each(builtinKinds)('kind conformance — %s', (kind) => {
	it('every headless cell holds or is recorded', async () => {
		const report = await runKindConformance(kind, BUILTIN_KIND_PROFILES[kind]);
		expect(new Set(report.cells.map((c) => c.cell))).toEqual(
			new Set(Object.keys(KIND_CELL_CONTRACTS))
		);
		for (const cell of report.cells) expect(cell.detail?.length).toBeGreaterThan(0);
	});
});

// ── Lockstep: no dead profiles ───────────────────────────────────────────────

describe('kind conformance: registry lockstep', () => {
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

describe('kind conformance: a fixtured kind produces green generic cells', () => {
	// Pinning `asserted`, not merely "the run resolved": a mechanism that quietly becomes
	// `boundary` is an unexercised cell, and stays green under a resolve-only check.
	it.each(fixturedKinds)('%s executes round-trip, merge, and undo (not boundary)', async (kind) => {
		const report = await runKindConformance(kind, BUILTIN_KIND_PROFILES[kind]);
		const asserted = (cell: string) =>
			expect(report.cells.find((c) => c.cell === cell)?.status).toBe('asserted');
		asserted('roundTrip');
		asserted('mergeBackspace');
		asserted('undo');
	});

	it('table clipboard executes its rectangular-copy mechanism', async () => {
		const report = await runKindConformance('table', BUILTIN_KIND_PROFILES.table);
		expect(report.cells.find((c) => c.cell === 'clipboard')?.status).toBe('asserted');
	});

	// The one built-in that isn't editable, so the scan has to skip it.
	it('thematicBreak searchPaint asserts the scan finds nothing in it', async () => {
		const report = await runKindConformance('thematicBreak');
		expect(report.cells.find((c) => c.cell === 'searchPaint')?.status).toBe('asserted');
	});
});

// ── The false-cell guard ─────────────────────────────────────────────────────
// Miss-analysis: no executable cell tested clipboard semantics, so a false byte-slice claim passed.
// The prose case proves the executor discriminates rather than always throwing.

/** A literal leaf between `%` lines, whose copy ending right after its one-character opening line
 *  adds its closing line: no byte slice, whatever its clipboard cell declares. */
function percentFence(): PluginBlockKind {
	const awaitsCloser = (raw: string) => {
		const [opener, ...rest] = raw.split('\n');
		return opener === '%' && !rest.includes('%');
	};
	return testLeaf('percent-fence', (kind) => ({
		opener: {
			priority: OPENER_PRIORITIES.fencedCode + 7,
			interruptsParagraph: (line) => line === '%',
			readingNotFinal: {
				notFinal: awaitsCloser,
				mayClose: (line) => line === '%',
				closer: () => '%'
			},
			tryOpen(ctx) {
				if (ctx.line.text !== '%') return null;
				let close = ctx.index + 1;
				while (close < ctx.end && ctx.lines[close].text !== '%') close++;
				if (close >= ctx.end) return null;
				const raw = ctx.lines
					.slice(ctx.index, close + 1)
					.map((line) => line.raw)
					.join('');
				return {
					node: { kind, leadingTrivia: ctx.leadingTrivia, raw },
					consumed: close + 1 - ctx.index
				};
			}
		}
	}));
}

describe('kind conformance: byte-slice clipboard executor is the false-cell guard', () => {
	it('throws for a kind whose copy adds its closing line, declared inherit-default', () => {
		expect(() => checkCopyIsRawByteSlice(percentFence(), '%\nx\n%\n')).toThrow(/raw byte slice/);
	});

	it('passes for a prose leaf whose copy is a true byte slice', () => {
		const fixture = getBlockKindDescriptor('paragraph').conformanceFixture!;
		expect(() => checkCopyIsRawByteSlice('paragraph', fixture)).not.toThrow();
	});
});
