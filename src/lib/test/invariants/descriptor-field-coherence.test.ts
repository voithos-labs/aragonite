import { describe, it, expect } from 'vitest';
import type { AnyBlockKind } from '../../core/nodes';
import {
	checkDescriptorFieldCoherence,
	type DescriptorFieldEntry
} from '../../invariants/registry';

const kind = (name: string) => name as AnyBlockKind;

const row = (over: Partial<DescriptorFieldEntry> = {}): DescriptorFieldEntry => ({
	kind: kind('mermaid'),
	declaresWholeBlockFocus: false,
	supportsInline: false,
	declaresReservedChrome: false,
	contextDependentKind: false,
	hasOpener: false,
	...over
});

describe('checkDescriptorFieldCoherence (G1.37)', () => {
	it('fires when a context-dependent kind also registers an opener', () => {
		const violation = checkDescriptorFieldCoherence([
			row({ kind: kind('tableCell'), contextDependentKind: true, hasOpener: true })
		]);
		expect(violation?.code).toBe('descriptor-field-coherence');
		expect(violation?.detail).toMatchObject({ kind: 'tableCell' });
	});

	it('fires when a whole-block-focus kind claims inline content', () => {
		const violation = checkDescriptorFieldCoherence([
			row({ declaresWholeBlockFocus: true, supportsInline: true })
		]);
		expect(violation?.message).toContain('addressable offsets');
	});

	it('fires when a whole-block-focus kind reserves a chrome slot', () => {
		const violation = checkDescriptorFieldCoherence([
			row({ declaresWholeBlockFocus: true, declaresReservedChrome: true })
		]);
		expect(violation?.message).toContain('never childless');
	});

	it('accepts each field alone', () => {
		expect(
			checkDescriptorFieldCoherence([
				row({ contextDependentKind: true }),
				row({ hasOpener: true, supportsInline: true }),
				row({ declaresWholeBlockFocus: true }),
				row({ declaresReservedChrome: true }),
				row({ declaresReservedChrome: true, supportsInline: true })
			])
		).toBeNull();
	});

	it('reports the offending kind out of a mixed set', () => {
		const violation = checkDescriptorFieldCoherence([
			row({ kind: kind('paragraph'), supportsInline: true }),
			row({ kind: kind('thematicBreak'), declaresWholeBlockFocus: true }),
			row({ kind: kind('badKind'), declaresWholeBlockFocus: true, supportsInline: true })
		]);
		expect(violation?.detail).toMatchObject({ kind: 'badKind' });
	});
});
