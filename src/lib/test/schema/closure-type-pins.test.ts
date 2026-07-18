import { afterEach, describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { getBlockKindDescriptor, registerBlockKind } from '$lib/schema/block-kind-descriptor';
import type { ClosureBlock } from '$lib/schema/closure';
import { simpleLeafClosure } from '$lib/schema/closure';
import { checkClosureCoherence, type ClosureCoherenceEntry } from '$lib/invariants/registry';
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

	// @ts-expect-error simpleLeafClosure still requires the four component-specific cells — simOracle omitted
	simpleLeafClosure({
		focus: { mode: 'implemented', via: 'f' },
		searchPaint: { mode: 'inherit-default' },
		undo: { mode: 'inherit-default' }
	});
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

// ── Preset coherence (G1.24) ────────────────────────────────────────────────
// The type gate cannot see `mergeRole`, so the runtime cross-check is what proves
// the baked `mergeBackspace: implemented` clears the not-mergeable rule — and what
// goes red if someone "simplifies" a baked cell to inherit-default.
describe('simpleLeafClosure keeps a not-mergeable leaf coherent', () => {
	const cells = {
		focus: { mode: 'implemented', via: 'test leaf caret' },
		searchPaint: { mode: 'implemented', via: 'raw scanned' },
		undo: { mode: 'inherit-default' },
		simOracle: { mode: 'inherit-default' }
	} as const;

	const coherenceEntry = (kind: AnyBlockKind): ClosureCoherenceEntry => {
		const d = getBlockKindDescriptor(kind);
		return {
			kind,
			notMergeable: d.mergeRole === 'not-mergeable',
			hasContainerContract: d.containerContract !== undefined,
			roundTripMode: d.closure.roundTrip.mode,
			mergeBackspaceMode: d.closure.mergeBackspace.mode
		};
	};

	it('passes for the baked preset', () => {
		const kind = declarePluginKind('preset-coherent');
		registerBlockKind(kind, { ...leaf, closure: simpleLeafClosure(cells) });
		expect(checkClosureCoherence([coherenceEntry(kind)])).toBeNull();
	});

	it('fires when a baked mergeBackspace is overridden to inherit-default', () => {
		const kind = declarePluginKind('preset-broken');
		registerBlockKind(kind, {
			...leaf,
			closure: simpleLeafClosure({ ...cells, mergeBackspace: { mode: 'inherit-default' } })
		});
		expect(checkClosureCoherence([coherenceEntry(kind)])?.detail).toMatchObject({
			kind: 'preset-broken',
			column: 'mergeBackspace'
		});
	});
});
