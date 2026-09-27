import { describe, it, expect } from 'vitest';
import type { AnyBlockKind } from '../../core/nodes';
import { checkReservedChromeCoherence } from '../../invariants/registry';

const kind = (name: string) => name as AnyBlockKind;
const has = (present: string[]) => (k: AnyBlockKind) => present.includes(k);

describe('checkReservedChromeCoherence (G1.18)', () => {
	it('fires when the chrome kind has no descriptor', () => {
		const violation = checkReservedChromeCoherence(
			[{ kind: kind('callout'), reservedChromeKind: kind('calloutTitle') }],
			has([]),
			has(['calloutTitle'])
		);
		expect(violation?.code).toBe('reserved-chrome-coherence');
		expect(violation?.detail).toMatchObject({ chromeKind: 'calloutTitle', missing: 'descriptor' });
	});

	it('fires when the chrome kind has a descriptor but no component', () => {
		const violation = checkReservedChromeCoherence(
			[{ kind: kind('callout'), reservedChromeKind: kind('calloutTitle') }],
			has(['calloutTitle']),
			has([])
		);
		expect(violation?.detail).toMatchObject({ chromeKind: 'calloutTitle', missing: 'component' });
	});

	it('passes when the chrome kind resolves to both', () => {
		expect(
			checkReservedChromeCoherence(
				[{ kind: kind('callout'), reservedChromeKind: kind('calloutTitle') }],
				has(['calloutTitle']),
				has(['calloutTitle'])
			)
		).toBeNull();
	});

	it('skips entries that declare no reservedChrome', () => {
		expect(
			checkReservedChromeCoherence([{ kind: kind('paragraph') }], has([]), has([]))
		).toBeNull();
	});
});
