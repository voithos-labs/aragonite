// Miss-analysis: the pairs were refused by the registration types alone, and no test registered one
// through a cast, the way a JavaScript plugin reaches the runtime.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import {
	augmentBlockKind,
	registerBlockKind,
	tryGetBlockKindDescriptor,
	type BlockKindAugmentation,
	type BlockKindRegistration
} from '#lib/schema/block-kind-descriptor.js';
import {
	INCOHERENT_REGISTRATION_PAIRS,
	type IncoherentPairId
} from '#lib/schema/registration-pairs.js';
import { testView } from '#lib/test/harness/test-view.js';
import { COLON_LINES } from '#lib/schema/colon-lines.js';
import { fencedLines } from '#lib/schema/fenced-lines.js';

const leaf = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	view: testView()
};
const group = { contract: 'opaque', rebuildRaw: () => {} };
const range = () => ({ start: 0, end: 0 });
const title = () => ({ kind: declarePluginKind('pair-title') });
const closed = { afterOpenerLine: true, beforeCloserLine: true };

const pairs: Record<IncoherentPairId, () => object> = {
	'content-start-without-range': () => ({ ...leaf, contentStart: { backspace: 'demote-first' } }),
	'whole-block-inline': () => ({ ...leaf, blockFocus: 'whole-block', supportsInline: true }),
	'container-inline': () => ({ ...leaf, supportsInline: true, container: group }),
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
	}),
	'context-dependent-opener': () => ({
		...leaf,
		contextDependentKind: true,
		opener: { priority: 9300, tryOpen: () => null, interruptsParagraph: false }
	}),
	'closing-line-merges': () => ({ ...leaf, container: { ...group, bodyWrap: closed, merges: {} } })
};

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
		const typed = INCOHERENT_REGISTRATION_PAIRS.filter((row) => !('untyped' in row));
		const tabled = new Set(typed.map((row) => row.id));
		expect([...pinned].sort()).toEqual([...tabled].sort());
	});

	// Miss-analysis: every pair was closed to an augment by fixing a field at registration, so no
	// test built one from a registration and an augment that are each coherent alone.
	it('refuses the pair an augment would complete, from either side, and merges nothing', () => {
		const declares = 'declares container.merges with a closing line of its own;';
		const fenced = declarePluginKind('pair-augment-fenced');
		registerBlockKind(fenced, {
			...leaf,
			container: { ...group, bodyWrap: closed }
		} as BlockKindRegistration);
		expect(() => augmentBlockKind(fenced, { container: { merges: {} } })).toThrow(
			`augmentBlockKind: "pair-augment-fenced" ${declares}`
		);
		expect(tryGetBlockKindDescriptor(fenced)?.merges).toBeUndefined();

		const merging = declarePluginKind('pair-augment-merging');
		registerBlockKind(merging, {
			...leaf,
			container: { ...group, merges: {} }
		} as BlockKindRegistration);
		const closing = { container: { bodyWrap: closed } } as BlockKindAugmentation;
		expect(() => augmentBlockKind(merging, closing)).toThrow(
			`augmentBlockKind: "pair-augment-merging" ${declares}`
		);
		expect(tryGetBlockKindDescriptor(merging)?.bodyWrap).toBeUndefined();
	});

	// The paste reads the closing line by truthiness, so plain JavaScript's `1` is one too.
	it('refuses the closing line however a plain-JavaScript caller spells it', () => {
		const kind = declarePluginKind('pair-truthy-closer');
		const truthy = {
			...leaf,
			container: { ...group, bodyWrap: { beforeCloserLine: 1 }, merges: {} }
		};
		expect(() => registerBlockKind(kind, truthy as unknown as BlockKindRegistration)).toThrow(
			'declares container.merges with a closing line of its own;'
		);
		expect(tryGetBlockKindDescriptor(kind)).toBeUndefined();
	});

	// Miss-analysis: every closing-line row spelled `bodyWrap` out, where a line shape that writes a
	// closing line implies it, after the pairs were read.
	it.each([
		['colon', COLON_LINES],
		['fenced', fencedLines({ open: () => ['<x>'], close: () => '</x>' })]
	])('refuses merges beside a %s line shape, which writes a closing line', (shape, lines) => {
		const kind = declarePluginKind(`pair-shape-${shape}`);
		const shaped = { ...leaf, container: { lines, merges: {} } };
		expect(() => registerBlockKind(kind, shaped as unknown as BlockKindRegistration)).toThrow(
			'declares container.merges with a closing line of its own;'
		);
		expect(tryGetBlockKindDescriptor(kind)).toBeUndefined();
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

		// Markers on every line with a merge rule, and a closing line with none.
		const marked = declarePluginKind('pair-ok-merging');
		registerBlockKind(marked, {
			...leaf,
			container: { ...group, bodyWrap: { afterOpenerLine: true }, merges: { key: 'name' } }
		} as BlockKindRegistration);

		expect(tryGetBlockKindDescriptor(chrome)?.reservedChrome).toBeDefined();
		expect(tryGetBlockKindDescriptor(unit)?.blockFocus).toBe('whole-block');
		expect(tryGetBlockKindDescriptor(marked)?.merges).toEqual({ key: 'name' });
	});
});
