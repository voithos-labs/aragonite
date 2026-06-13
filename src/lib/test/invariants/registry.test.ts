import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS, type BlockKind } from '../../core/nodes';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import {
	checkRegistryCompleteness,
	checkIsContainerIffRebuildRaw
} from '../../invariants/registry';

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

	// Every union member has a real descriptor — catches "added a kind, forgot
	// to register it". Component lookup is stubbed because components don't load
	// in the unit-test context (the real-registry gap is a Task 2 bootstrap concern).
	it('passes over real descriptors for all kinds', () => {
		expect(
			checkRegistryCompleteness(
				ALL_BLOCK_KINDS,
				(k) => tryGetBlockKindDescriptor(k) !== undefined,
				() => true
			)
		).toBeNull();
	});
});

describe('checkIsContainerIffRebuildRaw (G1.3)', () => {
	it('fires for a container kind missing rebuildRaw', () => {
		const violation = checkIsContainerIffRebuildRaw(['blockquote'], () => ({
			isContainer: true,
			hasRebuildRaw: false
		}));
		expect(violation?.code).toBe('container-rebuild-pairing');
		expect(violation?.detail).toMatchObject({ kind: 'blockquote', isContainer: true });
	});

	it('fires for a leaf kind that has rebuildRaw', () => {
		const violation = checkIsContainerIffRebuildRaw(['paragraph'], () => ({
			isContainer: false,
			hasRebuildRaw: true
		}));
		expect(violation?.detail).toMatchObject({ kind: 'paragraph', isContainer: false });
	});

	it('passes over the real registries', () => {
		expect(checkIsContainerIffRebuildRaw()).toBeNull();
	});
});
