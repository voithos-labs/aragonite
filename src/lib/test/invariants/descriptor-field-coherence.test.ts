import { describe, it, expect } from 'vitest';
import type { AnyBlockKind } from '../../core/nodes';
import {
	checkDescriptorFieldCoherence,
	type DescriptorFieldEntry
} from '../../invariants/registry';

const kind = (name: string) => name as AnyBlockKind;

const row = (over: Partial<DescriptorFieldEntry> = {}): DescriptorFieldEntry => ({
	kind: kind('tableCell'),
	contextDependentKind: false,
	hasOpener: false,
	...over
});

describe('checkDescriptorFieldCoherence (G1.37)', () => {
	it('fires when a context-dependent kind also registers an opener', () => {
		const violation = checkDescriptorFieldCoherence([
			row({ contextDependentKind: true, hasOpener: true })
		]);
		expect(violation?.code).toBe('descriptor-field-coherence');
		expect(violation?.detail).toMatchObject({ kind: 'tableCell' });
	});

	it('accepts each field alone', () => {
		expect(
			checkDescriptorFieldCoherence([row({ contextDependentKind: true }), row({ hasOpener: true })])
		).toBeNull();
	});

	it('reports the offending kind out of a mixed set', () => {
		const violation = checkDescriptorFieldCoherence([
			row({ kind: kind('paragraph'), hasOpener: true }),
			row({ kind: kind('badKind'), contextDependentKind: true, hasOpener: true })
		]);
		expect(violation?.detail).toMatchObject({ kind: 'badKind' });
	});
});
