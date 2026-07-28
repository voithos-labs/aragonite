import { describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import { ALL_BLOCK_KINDS } from '$lib/core/nodes';
import { checkClosureCoherence, type ClosureCoherenceEntry } from '$lib/invariants/registry';
import { closureCoherenceEntry } from '$lib/schema/registration-checks';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

// G1.24 — the closure-vs-descriptor cross-checks a compiler can't reach. The
// predicate is pure (entries injected); the fixture-parses-to-kind rule is a
// separate sweep — see closure-fixtures.test.ts — because a `parse` import here
// would close a schema → core/parser → schema cycle.

const entry = (over: Partial<ClosureCoherenceEntry>): ClosureCoherenceEntry => ({
	kind: 'k' as AnyBlockKind,
	notMergeable: false,
	hasContainerContract: false,
	roundTripMode: 'implemented',
	mergeBackspaceMode: 'implemented',
	declaresWholeBlockFocus: false,
	focusVia: undefined,
	mergeBackspaceVia: undefined,
	declaresReservedChrome: false,
	clipboardMode: 'implemented',
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

describe('checkClosureCoherence — focus-then-delete claim rule', () => {
	it('fires when a focus cell claims the model without blockFocus', () => {
		const v = checkClosureCoherence([
			entry({
				kind: 'f' as AnyBlockKind,
				focusVia: 'SomeBlock whole-block focus (focus-then-delete model)'
			})
		]);
		expect(v?.code).toBe('closure-coherence');
		expect(v?.message).toContain("blockFocus: 'whole-block'");
		expect(v?.detail).toMatchObject({ kind: 'f', column: 'focus' });
	});

	it('fires when only the mergeBackspace cell carries the claim', () => {
		const v = checkClosureCoherence([
			entry({
				kind: 'mb' as AnyBlockKind,
				mergeBackspaceVia:
					'not-mergeable — caret-adjacent Backspace focuses, a second press deletes'
			})
		]);
		expect(v?.detail).toMatchObject({ kind: 'mb', column: 'mergeBackspace' });
	});

	it('passes once the kind declares whole-block focus', () => {
		expect(
			checkClosureCoherence([
				entry({
					declaresWholeBlockFocus: true,
					focusVia: 'blockFocus=whole-block — focus-then-delete',
					mergeBackspaceVia: 'caret-adjacent Backspace focuses, a second press deletes'
				})
			])
		).toBeNull();
	});

	// The near-miss that must stay outside the vocabulary: an ordinary
	// not-mergeable leaf moves focus at its edge and deletes on the first press.
	it('leaves an edge-focus-moving leaf alone', () => {
		expect(
			checkClosureCoherence([
				entry({
					mergeBackspaceVia:
						'not-mergeable — Backspace at the edge moves focus, never concatenates',
					focusVia: 'focus walks into the first child'
				})
			])
		).toBeNull();
	});

	it('ignores the claim words in a non-implemented cell (no via to read)', () => {
		expect(checkClosureCoherence([entry({ focusVia: undefined })])).toBeNull();
	});
});

describe('checkClosureCoherence — reservedChrome clipboard rule', () => {
	it('fires when a chrome declarer leaves clipboard at inherit-default', () => {
		const v = checkClosureCoherence([
			entry({
				kind: 'rc' as AnyBlockKind,
				declaresReservedChrome: true,
				clipboardMode: 'inherit-default'
			})
		]);
		expect(v?.code).toBe('closure-coherence');
		expect(v?.detail).toMatchObject({ kind: 'rc', column: 'clipboard' });
	});

	it('accepts a chrome declarer naming its clipboard behavior or marking it unsupported', () => {
		expect(
			checkClosureCoherence([entry({ declaresReservedChrome: true, clipboardMode: 'implemented' })])
		).toBeNull();
		expect(
			checkClosureCoherence([
				entry({ declaresReservedChrome: true, clipboardMode: 'not-supported' })
			])
		).toBeNull();
	});

	it('leaves a chrome-free kind on the default clipboard cell', () => {
		expect(
			checkClosureCoherence([
				entry({ declaresReservedChrome: false, clipboardMode: 'inherit-default' })
			])
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
		const entries = ALL_BLOCK_KINDS.map((kind) =>
			closureCoherenceEntry(kind, getBlockKindDescriptor(kind))
		);
		expect(checkClosureCoherence(entries)).toBeNull();
	});
});
