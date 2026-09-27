// Miss-analysis: the pairs were refused by the registration types alone, and no test registered one
// through a cast, the way a JavaScript plugin reaches the runtime.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	registerBlockKind,
	tryGetBlockKindDescriptor,
	type BlockKindRegistration
} from '$lib/schema/block-kind-descriptor';
import {
	INCOHERENT_REGISTRATION_PAIRS,
	type IncoherentPairId
} from '$lib/schema/registration-pairs';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

const leaf = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
};
const group = { contract: 'opaque', rebuildRaw: () => {} };
const range = () => ({ start: 0, end: 0 });
const title = () => ({ kind: declarePluginKind('pair-title') });

const pairs: Record<IncoherentPairId, () => object> = {
	'content-start-without-range': () => ({ ...leaf, contentStart: { backspace: 'demote-first' } }),
	'whole-block-inline': () => ({ ...leaf, blockFocus: 'whole-block', supportsInline: true }),
	'whole-block-content-start': () => ({
		...leaf,
		blockFocus: 'whole-block',
		contentStart: { range }
	}),
	'whole-block-title-row': () => ({
		...leaf,
		blockFocus: 'whole-block',
		container: { ...group, reservedChrome: title() }
	}),
	'title-row-first-child-strategy': () => ({
		...leaf,
		container: {
			...group,
			reservedChrome: title(),
			unwrapRole: {
				firstChildBackspace: 'lift-first-child-keep-container',
				middleChildBackspace: 'default-merge'
			}
		}
	}),
	'keep-title-row-without-one': () => ({
		...leaf,
		container: {
			...group,
			unwrapRole: {
				firstChildBackspace: 'keep-reserved-chrome',
				middleChildBackspace: 'default-merge'
			}
		}
	})
};

afterEach(() => __resetSchemaRegistriesForTests());

describe('registerBlockKind refuses an incoherent pair the types refuse', () => {
	for (const row of INCOHERENT_REGISTRATION_PAIRS) {
		it(`refuses ${row.id} and registers nothing`, () => {
			const kind = declarePluginKind(`pair-${row.id}`);
			expect(() =>
				registerBlockKind(kind, pairs[row.id]() as unknown as BlockKindRegistration)
			).toThrow(`registerBlockKind: "pair-${row.id}" declares ${row.fields};`);
			expect(tryGetBlockKindDescriptor(kind)).toBeUndefined();
		});
	}

	// The table holds only runtime checks; each row's type pin carries its id in brackets.
	it('pairs every table row with a compile-time pin in the types test, and back', () => {
		const pins = readFileSync('src/lib/test/schema/descriptor-groups.types.test.ts', 'utf8');
		const pinned = new Set([...pins.matchAll(/@ts-expect-error \[([\w-]+)\]/g)].map((m) => m[1]));
		const tabled = new Set(INCOHERENT_REGISTRATION_PAIRS.map((row) => row.id));
		expect([...pinned].sort()).toEqual([...tabled].sort());
	});

	it('keeps a coherent registration of each shape', () => {
		const chrome = declarePluginKind('pair-ok-chrome');
		registerBlockKind(chrome, {
			...leaf,
			mergeRole: 'container',
			container: {
				...group,
				reservedChrome: title(),
				unwrapRole: { middleChildBackspace: 'default-merge' }
			}
		} as BlockKindRegistration);
		const unit = declarePluginKind('pair-ok-unit');
		registerBlockKind(unit, { ...leaf, blockFocus: 'whole-block' } as BlockKindRegistration);

		expect(tryGetBlockKindDescriptor(chrome)?.reservedChrome).toBeDefined();
		expect(tryGetBlockKindDescriptor(unit)?.blockFocus).toBe('whole-block');
	});
});
