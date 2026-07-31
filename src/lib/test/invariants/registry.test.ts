import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS, type BlockKind } from '../../core/nodes';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { checkRegistryCompleteness } from '../../invariants/registry';

const KINDS: BlockKind[] = ['paragraph', 'blockquote', 'list'];

describe('checkRegistryCompleteness (G1.2)', () => {
	it('fires when a kind has no descriptor', () => {
		const violation = checkRegistryCompleteness(
			KINDS,
			(k) => k !== 'blockquote',
			() => true
		);
		expect(violation?.code).toBe('registry-incomplete');
		expect(violation?.detail).toEqual({ kind: 'blockquote', missing: 'descriptor' });
	});

	it('fires when a kind has a descriptor but no component', () => {
		const violation = checkRegistryCompleteness(
			KINDS,
			() => true,
			(k) => k !== 'list'
		);
		expect(violation?.detail).toEqual({ kind: 'list', missing: 'component' });
	});

	it('passes when every kind resolves to both', () => {
		expect(
			checkRegistryCompleteness(
				KINDS,
				() => true,
				() => true
			)
		).toBeNull();
	});

	it('reports the descriptor gap before the component gap for the same kind', () => {
		const violation = checkRegistryCompleteness(
			['paragraph'],
			() => false,
			() => false
		);
		expect(violation?.detail).toEqual({ kind: 'paragraph', missing: 'descriptor' });
	});

	// Component lookup is stubbed because components don't load in the unit-test context;
	// the one real gap (`listItem`) is exempt by design and verified below.
	it('passes over real descriptors for all kinds', () => {
		expect(
			checkRegistryCompleteness(
				ALL_BLOCK_KINDS,
				(k) => tryGetBlockKindDescriptor(k) !== undefined,
				() => true
			)
		).toBeNull();
	});

	it('exempts listItem from the component check (renders inside its parent list)', () => {
		// listItem has no component-registry entry by design — the check must not
		// fire even when hasComponent reports it missing.
		expect(
			checkRegistryCompleteness(
				['list', 'listItem'],
				() => true,
				(k) => k !== 'listItem'
			)
		).toBeNull();
	});

	it('keeps the exemption narrow — a non-exempt missing component still fires', () => {
		const violation = checkRegistryCompleteness(
			['listItem', 'list'],
			() => true,
			(k) => k !== 'list'
		);
		expect(violation?.detail).toEqual({ kind: 'list', missing: 'component' });
	});
});
