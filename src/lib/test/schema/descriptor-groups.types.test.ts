import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	augmentBlockKind,
	getBlockKindDescriptor,
	registerBlockKind,
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

const group = { contract: 'opaque', rebuildRaw: () => {} } as const;
const range = () => ({ start: 0, end: 0 });

// ── Compile-time pins (G3.10) ───────────────────────────────────────────────
// Never called: `npm run check` is the gate. An "unused '@ts-expect-error'" error means a
// registration pairing two fields that can't mean anything together compiles again.
const typePins = (): void => {
	const kind = declarePluginKind('groups-pin');
	const title = declarePluginKind('groups-pin-title');

	// @ts-expect-error a content-start Backspace with no content range never fires
	registerBlockKind(kind, { ...leaf, contentStart: { backspace: 'demote-first' } });
	// @ts-expect-error the flat content-start Backspace field is gone from the registration
	registerBlockKind(kind, { ...leaf, contentStartBackspace: 'demote-first' });

	// @ts-expect-error a whole-block unit has no caret positions for inline content to live at
	registerBlockKind(kind, { ...leaf, blockFocus: 'whole-block', supportsInline: true });

	// @ts-expect-error a title row means the block is never childless, so whole-block focus never engages
	registerBlockKind(kind, {
		...leaf,
		blockFocus: 'whole-block',
		container: { ...group, reservedChrome: { kind: title } }
	});

	registerBlockKind(kind, {
		...leaf,
		container: {
			...group,
			reservedChrome: { kind: title },
			unwrapRole: {
				// @ts-expect-error lifting child 0 would carry the title row out as a sibling block
				firstChildBackspace: 'lift-first-child-keep-container',
				middleChildBackspace: 'default-merge'
			}
		}
	});

	registerBlockKind(kind, {
		...leaf,
		container: {
			...group,
			unwrapRole: {
				// @ts-expect-error keeping a title row that isn't there makes Backspace a dead key
				firstChildBackspace: 'keep-reserved-chrome',
				middleChildBackspace: 'default-merge'
			}
		}
	});

	registerBlockKind(kind, {
		...leaf,
		container: {
			...group,
			reservedChrome: { kind: title },
			unwrapRole: {
				// @ts-expect-error a title row implies its first-child strategy, so none is declared
				firstChildBackspace: 'keep-reserved-chrome',
				middleChildBackspace: 'default-merge'
			}
		}
	});

	// @ts-expect-error a title row lives in the container group, never on a leaf
	registerBlockKind(kind, { ...leaf, reservedChrome: { kind: title } });

	// An augment could assemble any pair above behind the registration's back, so it takes none.
	// @ts-expect-error focus is fixed at registration
	augmentBlockKind(kind, { blockFocus: 'whole-block' });
	// @ts-expect-error inline support is fixed at registration
	augmentBlockKind(kind, { supportsInline: true });
	// @ts-expect-error the content start is fixed at registration
	augmentBlockKind(kind, { contentStart: { range } });
	// @ts-expect-error the flat content-start Backspace field is gone from the augment too
	augmentBlockKind(kind, { contentStartBackspace: 'demote-first' });
	// @ts-expect-error a title row is fixed at registration
	augmentBlockKind(kind, { container: { reservedChrome: { kind: title } } });
	augmentBlockKind(kind, {
		container: {
			// @ts-expect-error the unwrap strategies are fixed at registration
			unwrapRole: {
				firstChildBackspace: 'lift-first-child-keep-container',
				middleChildBackspace: 'default-merge'
			}
		}
	});
};
void typePins;

// ── Normalization into the flat read shape ─────────────────────────────────

describe('registerBlockKind flattens the descriptor groups', () => {
	afterEach(() => __resetSchemaRegistriesForTests());

	it('writes a content start into the range and Backspace fields the editor reads', () => {
		const kind = declarePluginKind('groups-content-start');
		registerBlockKind(kind, {
			...leaf,
			supportsInline: true,
			contentStart: { range, backspace: 'demote-first' }
		});

		const d = getBlockKindDescriptor(kind);
		expect(d.getContentRange).toBe(range);
		expect(d.contentStartBackspace).toBe('demote-first');
		expect('contentStart' in d).toBe(false);
	});

	it('gives a title-row container the strategy that keeps child 0', () => {
		const kind = declarePluginKind('groups-chrome');
		registerBlockKind(kind, {
			...leaf,
			container: {
				...group,
				reservedChrome: { kind: declarePluginKind('groups-chrome-title') },
				unwrapRole: { middleChildBackspace: 'default-merge' }
			}
		});

		expect(getBlockKindDescriptor(kind).unwrapRole).toEqual({
			firstChildBackspace: 'keep-reserved-chrome',
			middleChildBackspace: 'default-merge'
		});
	});

	it('leaves a title-row container that declares no unwrap role without one', () => {
		const kind = declarePluginKind('groups-chrome-bare');
		registerBlockKind(kind, {
			...leaf,
			container: { ...group, reservedChrome: { kind: declarePluginKind('groups-bare-title') } }
		});

		expect(getBlockKindDescriptor(kind).unwrapRole).toBeUndefined();
	});

	// A widened flat descriptor escapes the types, so the runtime strip is what keeps the group
	// the only source; the cast stands in for a JS caller.
	it('drops a flat content range that arrives outside the group', () => {
		const kind = declarePluginKind('groups-widened');
		registerBlockKind(kind, getBlockKindDescriptor('heading') as BlockKindRegistration);

		const d = getBlockKindDescriptor(kind);
		expect(d.getContentRange).toBeUndefined();
		expect(d.contentStartBackspace).toBeUndefined();
	});
});
