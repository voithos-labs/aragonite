import { describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import { ALL_BLOCK_KINDS } from '$lib/core/nodes';
import { checkClosureCoherence, type ClosureCoherenceEntry } from '$lib/invariants/registry';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

// G1.24 — the two closure-vs-descriptor cross-checks a compiler can't reach.
// The predicate is pure (entries injected); the third rule (fixture parses to
// kind) is a separate sweep — see closure-fixtures.test.ts — because a `parse`
// import here would close a schema → core/parser → schema cycle.

const entry = (over: Partial<ClosureCoherenceEntry>): ClosureCoherenceEntry => ({
	kind: 'k' as AnyBlockKind,
	notMergeable: false,
	hasContainerContract: false,
	roundTripMode: 'implemented',
	mergeBackspaceMode: 'implemented',
	...over
});

describe('checkClosureCoherence — container round-trip rule', () => {
	it('fires when a container declares roundTrip: inherit-default', () => {
		const v = checkClosureCoherence([
			entry({
				kind: 'c' as AnyBlockKind,
				hasContainerContract: true,
				roundTripMode: 'inherit-default'
			})
		]);
		expect(v?.code).toBe('closure-coherence');
		expect(v?.message).toContain('container contract');
		expect(v?.detail).toMatchObject({ kind: 'c', column: 'roundTrip' });
	});

	it('passes a container with roundTrip: implemented', () => {
		expect(
			checkClosureCoherence([entry({ hasContainerContract: true, roundTripMode: 'implemented' })])
		).toBeNull();
	});

	it('leaves a non-container free to declare roundTrip: inherit-default', () => {
		expect(
			checkClosureCoherence([
				entry({ hasContainerContract: false, roundTripMode: 'inherit-default' })
			])
		).toBeNull();
	});
});

describe('checkClosureCoherence — not-mergeable merge rule', () => {
	it('fires when a not-mergeable kind declares mergeBackspace: inherit-default', () => {
		const v = checkClosureCoherence([
			entry({
				kind: 'm' as AnyBlockKind,
				notMergeable: true,
				mergeBackspaceMode: 'inherit-default'
			})
		]);
		expect(v?.code).toBe('closure-coherence');
		expect(v?.detail).toMatchObject({ kind: 'm', column: 'mergeBackspace' });
	});

	it('accepts a not-mergeable kind naming a mechanism (implemented) or marking it not-supported', () => {
		expect(
			checkClosureCoherence([entry({ notMergeable: true, mergeBackspaceMode: 'implemented' })])
		).toBeNull();
		expect(
			checkClosureCoherence([entry({ notMergeable: true, mergeBackspaceMode: 'not-supported' })])
		).toBeNull();
	});

	it('leaves a mergeable kind free to inherit the default merge', () => {
		expect(
			checkClosureCoherence([entry({ notMergeable: false, mergeBackspaceMode: 'inherit-default' })])
		).toBeNull();
	});
});

describe('checkClosureCoherence — reporting', () => {
	it('returns null for an empty batch', () => {
		expect(checkClosureCoherence([])).toBeNull();
	});

	it('reports the first offender only', () => {
		const v = checkClosureCoherence([
			entry({ kind: 'ok' as AnyBlockKind }),
			entry({
				kind: 'bad1' as AnyBlockKind,
				notMergeable: true,
				mergeBackspaceMode: 'inherit-default'
			}),
			entry({
				kind: 'bad2' as AnyBlockKind,
				hasContainerContract: true,
				roundTripMode: 'inherit-default'
			})
		]);
		expect(v?.detail).toMatchObject({ kind: 'bad1' });
	});
});

// Integration: the shipped built-in descriptors must all be coherent, so a
// future edit that regresses a real cell (a container downgraded to
// inherit-default round-trip, say) fails here even before the flush runs.
describe('every built-in descriptor is closure-coherent', () => {
	it('produces no violation over ALL_BLOCK_KINDS', () => {
		const entries = ALL_BLOCK_KINDS.map((kind): ClosureCoherenceEntry => {
			const d = getBlockKindDescriptor(kind);
			return {
				kind,
				notMergeable: d.mergeRole === 'not-mergeable',
				hasContainerContract: d.containerContract !== undefined,
				roundTripMode: d.closure.roundTrip.mode,
				mergeBackspaceMode: d.closure.mergeBackspace.mode
			};
		});
		expect(checkClosureCoherence(entries)).toBeNull();
	});
});
