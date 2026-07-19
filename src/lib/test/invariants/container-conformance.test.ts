import { describe, it, expect } from 'vitest';
import { isBuiltinBlockKind } from '$lib/core/nodes';
import { getAllRegisteredKinds, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import {
	assertExemptionDocumented,
	checkDeclarationSanity,
	checkFocusBubbleTermination,
	checkGridLocalIndexAddressing,
	checkInnermostFirstAncestry,
	checkOneUndoPerMultiScope,
	checkStripLocalIndexAddressing,
	reversedAncestryLeavesRootStale
} from '$lib/testing/container-conformance';
import { CONTAINER_PROFILES } from './builtin-container-profiles';

// Registry-derived: every kind whose descriptor declares it a container. Built-ins
// only — a plugin container is not in this process's registry unless its suite
// installed it, so it opts into the same kit explicitly through
// `runContainerConformance` (`aragonite/testing`); see
// `test/plugins/container-conformance-plugin.test.ts`.
const registeredContainerKinds = getAllRegisteredKinds()
	.filter(isBuiltinBlockKind)
	.filter((k) => getBlockKindDescriptor(k).isContainer);

// ── Completeness: the auto-coverage mechanism ───────────────────────────────────
// A registered built-in container with no profile FAILS here, so a new built-in
// container kind can't slip through untested; a stale profile (no matching
// registered kind) also fails, so the map can't silently drift from the registry.

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
});

// ── Parametrized per-kind kit ───────────────────────────────────────────────────
// Coverage matrix (assert / exempt / boundary) lives in CONTAINER_PROFILES. One
// case per invariant, so a failure names the invariant that broke.

describe.each(registeredContainerKinds)('G4.3 conformance kit — %s', (kind) => {
	const profile = CONTAINER_PROFILES[kind]!;
	const isGrid = getBlockKindDescriptor(kind).containerContract === 'grid';

	it('(a) local-index addressing', async () => {
		if (profile.localIndex.mode !== 'assert') {
			assertExemptionDocumented(profile.localIndex, `${kind} (a) local-index`);
			return;
		}
		if (isGrid) await checkGridLocalIndexAddressing();
		else await checkStripLocalIndexAddressing(profile);
	});

	it('(b) innermost-first ancestry rebuild', () => {
		if (profile.ancestry.mode !== 'assert') {
			assertExemptionDocumented(profile.ancestry, `${kind} (b) ancestry`);
			return;
		}
		checkInnermostFirstAncestry(kind, profile);
		// Non-vacuous: a reversed (outer-first) rebuild must leave the root stale.
		expect(
			reversedAncestryLeavesRootStale(profile),
			`reversed rebuild leaves "${kind}" root stale`
		).toBe(true);
	});

	it('(c) one undo entry per multi-scope op', async () => {
		if (profile.multiScope.mode !== 'assert') {
			assertExemptionDocumented(profile.multiScope, `${kind} (c) multi-scope`);
			return;
		}
		await checkOneUndoPerMultiScope(kind);
	});

	it('(d) focus-bubble termination at root', async () => {
		if (profile.focusBubble.mode !== 'assert') {
			assertExemptionDocumented(profile.focusBubble, `${kind} (d) focus-bubble`);
			return;
		}
		await checkFocusBubbleTermination(kind, profile);
	});

	// Applies to every container kind — conditional internally on what the
	// descriptor declares, so no coverage cell.
	it('(e) declaration sanity (unwrapRole / containerPaste / rebuildRaw)', () => {
		checkDeclarationSanity(kind, profile);
	});
});
