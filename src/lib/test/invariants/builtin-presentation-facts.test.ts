import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS, type AnyBlockKind } from '../../core/nodes';
import {
	checkBuiltinPresentationFacts,
	type PresentationFactEntry
} from '../../invariants/registry';
import { registerBuiltInDescriptors } from '../../schema/built-in-descriptors';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';

const row = (over: Partial<PresentationFactEntry> = {}): PresentationFactEntry => ({
	kind: 'paragraph' as AnyBlockKind,
	declaresPageRole: true,
	declaresEstimateHeight: true,
	...over
});

describe('checkBuiltinPresentationFacts (G1.40)', () => {
	it('fires for a built-in with no page role, naming the field', () => {
		const violation = checkBuiltinPresentationFacts([row({ declaresPageRole: false })]);
		expect(violation?.code).toBe('builtin-presentation-facts');
		expect(violation?.detail).toEqual({ kind: 'paragraph', missing: 'pageRole' });
	});

	it('fires for a built-in with no height estimate', () => {
		const violation = checkBuiltinPresentationFacts([row({ declaresEstimateHeight: false })]);
		expect(violation?.detail).toEqual({ kind: 'paragraph', missing: 'estimateHeight' });
	});

	it('passes the built-in registrations as they stand', () => {
		registerBuiltInDescriptors();
		const entries = ALL_BLOCK_KINDS.map((kind) => {
			const d = getBlockKindDescriptor(kind);
			return {
				kind,
				declaresPageRole: d.pageRole !== undefined,
				declaresEstimateHeight: d.estimateHeight !== undefined
			};
		});
		expect(checkBuiltinPresentationFacts(entries)).toBeNull();
	});
});
