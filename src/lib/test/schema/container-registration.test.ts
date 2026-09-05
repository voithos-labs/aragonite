import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	augmentBlockKind,
	getBlockKindDescriptor,
	registerBlockKind,
	tryGetBlockKindDescriptor,
	type BlockKindRegistration
} from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

const leaf = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
} as const;

const UNWRAP = {
	firstChildBackspace: 'lift-first-child-keep-container',
	middleChildBackspace: 'default-merge'
} as const;

afterEach(() => __resetSchemaRegistriesForTests());

// ── Compile-time pins ───────────────────────────────────────────────────────
// Never invoked — `npm run check` is the gate. An "unused '@ts-expect-error'"
// error on any pin means an illegal registration shape compiled again.
const typePins = (): void => {
	const kind = declarePluginKind('shape-pin');
	// @ts-expect-error rebuildRaw lives in the container group, not at top level
	registerBlockKind(kind, { ...leaf, rebuildRaw: () => {} });
	// @ts-expect-error a container group without rebuildRaw is incomplete
	registerBlockKind(kind, { ...leaf, container: { contract: 'strip' } });
	// @ts-expect-error unwrapRole lives in the container group, not at top level
	registerBlockKind(kind, { ...leaf, unwrapRole: UNWRAP });
};
void typePins;

// ── Normalization ───────────────────────────────────────────────────────────

describe('registerBlockKind normalizes the container group', () => {
	it('spreads group fields flat and derives isContainer for a container registration', () => {
		const kind = declarePluginKind('norm-container');
		const rebuildRaw = (): void => {};
		registerBlockKind(kind, {
			...leaf,
			container: { contract: 'opaque', rebuildRaw, unwrapRole: UNWRAP }
		});

		const d = tryGetBlockKindDescriptor(kind)!;
		expect(d.isContainer).toBe(true);
		expect(d.containerContract).toBe('opaque');
		expect(d.rebuildRaw).toBe(rebuildRaw);
		expect(d.unwrapRole).toEqual(UNWRAP);
		expect('container' in d).toBe(false);
	});

	it('derives isContainer: false for a leaf registration', () => {
		const kind = declarePluginKind('norm-leaf');
		registerBlockKind(kind, leaf);

		const d = tryGetBlockKindDescriptor(kind)!;
		expect(d.isContainer).toBe(false);
		expect(d.rebuildRaw).toBeUndefined();
	});

	it('a stale isContainer property on a non-fresh registration object cannot leak', () => {
		const kind = declarePluginKind('norm-stale');
		registerBlockKind(kind, { ...leaf, isContainer: true } as BlockKindRegistration);
		expect(tryGetBlockKindDescriptor(kind)?.isContainer).toBe(false);
	});

	// Excess-property checks bite only fresh literals, so the widened calls below compile
	// with no cast — the runtime strip is the only defense left to pin.
	it('a widened flat descriptor cannot smuggle container-only fields past the group', () => {
		const kind = declarePluginKind('norm-widened');
		registerBlockKind(kind, getBlockKindDescriptor('blockquote'));

		const d = tryGetBlockKindDescriptor(kind)!;
		expect(d.isContainer).toBe(false);
		expect(d.rebuildRaw).toBeUndefined();
		expect(d.containerContract).toBeUndefined();
		expect(d.reservedChrome).toBeUndefined();
		expect(d.containerPaste).toBeUndefined();
		expect(d.unwrapRole).toBeUndefined();
	});

	it('a widened flat descriptor cannot smuggle container-only fields through augment', () => {
		const kind = declarePluginKind('aug-widened');
		registerBlockKind(kind, leaf);
		augmentBlockKind(kind, getBlockKindDescriptor('blockquote'));

		const d = tryGetBlockKindDescriptor(kind)!;
		expect(d.isContainer).toBe(false);
		expect(d.rebuildRaw).toBeUndefined();
		expect(d.containerContract).toBeUndefined();
	});
});

// ── Group merge on augment ──────────────────────────────────────────────────

describe('augment merges a partial container group', () => {
	function registerContainer(name: string) {
		const kind = declarePluginKind(name);
		const rebuildRaw = (): void => {};
		registerBlockKind(kind, {
			...leaf,
			mergeRole: 'container',
			container: { contract: 'opaque', rebuildRaw }
		});
		return { kind, rebuildRaw };
	}

	it('adds a group field while preserving the rest of the group', () => {
		const { kind, rebuildRaw } = registerContainer('aug-partial');
		augmentBlockKind(kind, { container: { unwrapRole: UNWRAP } });

		const d = tryGetBlockKindDescriptor(kind)!;
		expect(d.unwrapRole).toEqual(UNWRAP);
		expect(d.rebuildRaw).toBe(rebuildRaw);
		expect(d.containerContract).toBe('opaque');
	});

	it('an explicitly-undefined group field cannot unset the contract/rebuild pairing', () => {
		const { kind, rebuildRaw } = registerContainer('aug-undefined');
		augmentBlockKind(kind, { container: { rebuildRaw: undefined } });
		expect(tryGetBlockKindDescriptor(kind)?.rebuildRaw).toBe(rebuildRaw);
	});

	// The merge must read the group generically: a hand-kept field list silently swallows
	// whichever group field it has not caught up with, and the augment still "succeeds".
	it('carries a group field the merge was never written to name', () => {
		const { kind } = registerContainer('aug-every-field');
		const bodyWrite = { normalize: (raw: string) => raw, mapOffset: (_r: string, o: number) => o };
		augmentBlockKind(kind, { container: { bodyWrite } });

		expect(tryGetBlockKindDescriptor(kind)?.bodyWrite).toBe(bodyWrite);
	});
});
