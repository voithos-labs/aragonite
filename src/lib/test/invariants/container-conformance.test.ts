import { describe, it, expect } from 'vitest';
import { isBuiltinBlockKind } from '$lib/core/nodes';
import { getAllRegisteredKinds, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { assertExemptionDocumented } from '$lib/testing/conformance-core';
import {
	assertProfileCoverageFloor,
	CONTAINER_CONFORMANCE_CELLS,
	reversedAncestryLeavesRootStale
} from '$lib/testing/container-conformance';
import { CONTAINER_PROFILES } from './builtin-container-profiles';

// Built-ins only: a plugin container is absent from this process's registry unless its own
// suite installed it, and opts into the same kit through `runContainerConformance` (see
// `test/plugins/container-conformance.test.ts`).
const registeredContainerKinds = getAllRegisteredKinds()
	.filter(isBuiltinBlockKind)
	.filter((k) => getBlockKindDescriptor(k).isContainer);

// ── Completeness: the auto-coverage mechanism ───────────────────────────────────
// Both directions fail: an unprofiled container kind slips through untested, and a stale
// profile means the map drifted from the registry.

describe('G4.3 container conformance — registry coverage', () => {
	it('every registered container kind has a conformance profile', () => {
		const missing = registeredContainerKinds.filter((k) => !CONTAINER_PROFILES[k]);
		expect(missing, 'unprofiled registered container kinds').toEqual([]);
	});

	it('every conformance profile maps to a registered container kind', () => {
		const stale = Object.keys(CONTAINER_PROFILES).filter(
			(k) => !registeredContainerKinds.includes(k as (typeof registeredContainerKinds)[number])
		);
		expect(stale, 'profiles with no matching registered container').toEqual([]);
	});

	it('derives a non-empty container set from the registry', () => {
		expect(registeredContainerKinds.length).toBeGreaterThan(0);
	});

	// The floor under the matrix: five excused cells is five reviewed reasons and zero coverage.
	it.each(registeredContainerKinds)('%s asserts at least one behavioral cell', (kind) => {
		assertProfileCoverageFloor(kind, CONTAINER_PROFILES[kind]!);
	});
});

// ── Parametrized per-kind kit ───────────────────────────────────────────────────
// Cells come from the kit's own manifest rather than a list here, so a cell added there runs
// over every built-in the day it lands. Coverage (assert / exempt / boundary) lives in
// CONTAINER_PROFILES, and one case per cell keeps a failure naming the invariant that broke.

describe.each(registeredContainerKinds)('G4.3 conformance kit — %s', (kind) => {
	const profile = CONTAINER_PROFILES[kind]!;

	it.each(CONTAINER_CONFORMANCE_CELLS.map((c) => [c.cell, c] as const))(
		'%s',
		async (_name, { coverage, run }) => {
			const declared = coverage(profile);
			if (declared.mode !== 'assert') {
				assertExemptionDocumented(declared, `${kind} ${_name}`);
				return;
			}
			await run(kind, profile);
		}
	);

	// Non-vacuous ancestry: a reversed (outer-first) rebuild must leave the root stale.
	it('ancestry check is non-vacuous', () => {
		if (profile.ancestry.mode !== 'assert') return;
		expect(
			reversedAncestryLeavesRootStale(profile),
			`reversed rebuild leaves "${kind}" root stale`
		).toBe(true);
	});
});
