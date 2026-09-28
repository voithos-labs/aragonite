import { describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	augmentBlockKind,
	getBlockKindDescriptor,
	registerBlockKind,
	tryGetBlockKindDescriptor,
	type BlockKindAugmentation,
	type BlockKindRegistration
} from '$lib/schema/block-kind-descriptor';
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

// ── Compile-time pins ───────────────────────────────────────────────────────
// Never called: `npm run check` is the gate. An "unused '@ts-expect-error'"
// error on any of these means an illegal registration shape compiled again.
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

	// A widened value escapes excess-property checks, so what the code strips at runtime is the
	// only protection to test; the casts here stand in for a JS caller.
	it('a widened flat descriptor cannot smuggle container-only fields past the group', () => {
		const kind = declarePluginKind('norm-widened');
		registerBlockKind(kind, getBlockKindDescriptor('blockquote') as BlockKindRegistration);

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
		// A fixed field would throw before the strip, so the widened value drops blockquote's one.
		const { supportsInline: _fixed, ...widened } = getBlockKindDescriptor('blockquote');
		augmentBlockKind(kind, widened as unknown as BlockKindAugmentation);

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
		const reorderChildren = { renumberMarkers: true } as const;
		augmentBlockKind(kind, { container: { reorderChildren } });

		const d = tryGetBlockKindDescriptor(kind)!;
		expect(d.reorderChildren).toEqual(reorderChildren);
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
