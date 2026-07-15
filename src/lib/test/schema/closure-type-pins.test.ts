import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { getBlockKindDescriptor, registerBlockKind } from '$lib/schema/block-kind-descriptor';
import type { ClosureBlock } from '$lib/schema/closure';
import { testClosure } from '$lib/test/support/closure';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

const leaf = { mergeRole: 'not-mergeable', editable: true, supportsInline: false } as const;

afterEach(() => __resetSchemaRegistriesForTests());

// ── Compile-time pins ───────────────────────────────────────────────────────
// Never invoked — `npm run check` is the gate. An "unused '@ts-expect-error'"
// error on any pin means an illegal closure shape compiled again.
const typePins = (): void => {
	const kind = declarePluginKind('closure-type-pin');

	// @ts-expect-error a registration without `closure` is incomplete
	registerBlockKind(kind, { ...leaf });

	// @ts-expect-error a closure block missing a column (Record<ClosureColumn, …>) is incomplete
	registerBlockKind(kind, { ...leaf, closure: { roundTrip: { mode: 'inherit-default' } } });

	// @ts-expect-error an `implemented` cell requires a `via` string
	const missingVia: ClosureBlock = { ...testClosure, focus: { mode: 'implemented' } };
	void missingVia;

	// @ts-expect-error a `not-supported` cell requires a `reason` string
	const missingReason: ClosureBlock = { ...testClosure, focus: { mode: 'not-supported' } };
	void missingReason;
};
void typePins;

// ── Read-side wiring ──────────────────────────────────────────────────────────
// closure is a flat (non-container) field, so it must survive normalization onto
// the read-side descriptor whether the kind registers as a leaf or with a
// container group — the same stripContainerOnlyKeys path blockFocus rides.
describe('closure lands on the read-side descriptor', () => {
	it('survives leaf registration', () => {
		const kind = declarePluginKind('closure-leaf');
		registerBlockKind(kind, { ...leaf, closure: testClosure });
		expect(getBlockKindDescriptor(kind).closure).toEqual(testClosure);
	});

	it('survives registration alongside a container group', () => {
		const kind = declarePluginKind('closure-container');
		registerBlockKind(kind, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			container: { contract: 'opaque', rebuildRaw: () => {} },
			closure: testClosure
		});
		const descriptor = getBlockKindDescriptor(kind);
		expect(descriptor.isContainer).toBe(true);
		expect(descriptor.closure).toEqual(testClosure);
	});
});
