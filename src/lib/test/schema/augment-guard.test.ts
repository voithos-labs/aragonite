import { describe, expect, it } from 'vitest';
import { declarePluginKind, declaredPluginKind } from '$lib/schema/plugin-kind';
import {
	registerBlockKind,
	augmentBlockKind,
	augmentBuiltin,
	tryGetBlockKindDescriptor,
	FIXED_AT_REGISTRATION,
	type BlockKindAugmentation
} from '$lib/schema/block-kind-descriptor';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { testClosure } from '$lib/test/support/closure';

const minimal = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
} as const;

describe('augmentBlockKind rejects built-in kinds', () => {
	it('throws when the kind is a built-in: a plugin cannot rewrite it', () => {
		// `editable: true` is a no-op merge, so a missing throw cannot corrupt paragraph.
		expect(() => augmentBlockKind('paragraph', { editable: true })).toThrow(/built-in/i);
	});

	it('still throws for an unregistered plugin kind (no accidental creation)', () => {
		const kind = declarePluginKind('neverRegistered');
		expect(() => augmentBlockKind(kind, { editable: false })).toThrow(/no base descriptor/i);
	});

	it('merges into a registered plugin kind: the surviving public path', () => {
		const kind = declarePluginKind('augmentablePlugin');
		registerBlockKind(kind, minimal);
		augmentBlockKind(kind, { renderImagesAsWidgets: true });
		expect(tryGetBlockKindDescriptor(kind)?.renderImagesAsWidgets).toBe(true);
	});
});

describe('container-group augments are gated on the registered category', () => {
	it('throws for a plugin kind registered as a leaf', () => {
		const kind = declarePluginKind('leafNoContainerAugment');
		registerBlockKind(kind, minimal);
		expect(() => augmentBlockKind(kind, { container: { rebuildRaw: () => {} } })).toThrow(
			/registered as a leaf/
		);
	});

	it('augmentBuiltin shares the gate: a built-in leaf refuses container fields', () => {
		expect(() => augmentBuiltin('paragraph', { container: { rebuildRaw: () => {} } })).toThrow(
			/registered as a leaf/
		);
	});
});

// Miss-analysis: the fixed fields were refused by the augment type alone, and no test augmented
// one through a cast, the way a JavaScript plugin reaches the runtime.
describe('fields fixed at registration refuse every augment', () => {
	const title = declarePluginKind('fixedTitle');
	const lift = {
		firstChildBackspace: 'lift-first-child-keep-container',
		middleChildBackspace: 'default-merge'
	};
	const cases: { field: (typeof FIXED_AT_REGISTRATION)[number]; fields: object }[] = [
		{ field: 'blockFocus', fields: { blockFocus: 'whole-block' } },
		{ field: 'supportsInline', fields: { supportsInline: true } },
		{ field: 'contentStart', fields: { contentStart: { range: () => ({ start: 1, end: 1 }) } } },
		{
			field: 'container.reservedChrome',
			fields: { container: { reservedChrome: { kind: title } } }
		},
		{ field: 'container.unwrapRole', fields: { container: { unwrapRole: lift } } }
	];

	it('names a case for every fixed field', () => {
		expect(cases.map((c) => c.field).sort()).toEqual([...FIXED_AT_REGISTRATION].sort());
	});

	function registerContainer(name: string) {
		const kind = declarePluginKind(name);
		registerBlockKind(kind, {
			...minimal,
			mergeRole: 'container',
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		return kind;
	}

	for (const { field, fields } of cases) {
		it(`augmentBlockKind refuses ${field} and leaves the descriptor as registered`, () => {
			const kind = registerContainer(`fixed-${field.replace('.', '-')}`);
			const before = { ...tryGetBlockKindDescriptor(kind) };
			expect(() => augmentBlockKind(kind, fields as BlockKindAugmentation)).toThrow(
				new RegExp(`augmentBlockKind: .*${field.replace('.', '\\.')}.*fixed at registration`)
			);
			expect(tryGetBlockKindDescriptor(kind)).toEqual(before);
		});
	}

	it('augmentBuiltin shares the refusal', () => {
		expect(() =>
			augmentBuiltin('blockquote', {
				container: { unwrapRole: lift }
			} as unknown as BlockKindAugmentation)
		).toThrow(/augmentBuiltin: .*container\.unwrapRole.*fixed at registration/);
	});

	// An explicit undefined would spread over the registered value, so presence alone refuses.
	it('refuses a fixed field set to undefined', () => {
		const kind = declarePluginKind('fixedUndefined');
		registerBlockKind(kind, { ...minimal, supportsInline: true });
		expect(() =>
			augmentBlockKind(kind, { supportsInline: undefined } as unknown as BlockKindAugmentation)
		).toThrow(/supportsInline.*fixed at registration/);
		expect(tryGetBlockKindDescriptor(kind)?.supportsInline).toBe(true);
	});
});

describe('augmentBlockKind ownership gate', () => {
	// Owner is recorded only while a plugin's setup runs (declarePluginKind reads
	// currentInstallingPlugin), so ownership scenarios drive through installPlugins.
	it("rejects a plugin augmenting another plugin's kind, naming both", () => {
		installPlugins([
			definePlugin({
				name: 'owner-plugin',
				setup() {
					registerBlockKind(declarePluginKind('ownedKind'), minimal);
				}
			})
		]);

		expect(() =>
			installPlugins([
				definePlugin({
					name: 'intruder-plugin',
					setup() {
						augmentBlockKind(declaredPluginKind('ownedKind'), { renderImagesAsWidgets: true });
					}
				})
			])
		).toThrow(/owner-plugin[\s\S]*intruder-plugin|intruder-plugin[\s\S]*owner-plugin/);
	});

	it('allows a plugin to augment its own kind from its setup', () => {
		installPlugins([
			definePlugin({
				name: 'self-plugin',
				setup() {
					const kind = declarePluginKind('selfOwnedKind');
					registerBlockKind(kind, minimal);
					augmentBlockKind(kind, { renderImagesAsWidgets: true });
				}
			})
		]);
		expect(
			tryGetBlockKindDescriptor(declaredPluginKind('selfOwnedKind'))?.renderImagesAsWidgets
		).toBe(true);
	});

	it('rejects a top-level augment of an owned kind after install (only its plugin may)', () => {
		installPlugins([
			definePlugin({
				name: 'owner-plugin',
				setup() {
					registerBlockKind(declarePluginKind('ownedKind'), minimal);
				}
			})
		]);

		// No install is active here (currentInstallingPlugin() is null), so this is a consumer or
		// harness augmenting a plugin-owned kind, and that is still a silent override.
		expect(() =>
			augmentBlockKind(declaredPluginKind('ownedKind'), { renderImagesAsWidgets: true })
		).toThrow(/only plugin 'owner-plugin'/);
	});

	it('leaves an ownerless (harness-declared) kind open to augmentation', () => {
		// Declared outside any install → no recorded owner → the test/harness path stays open.
		const kind = declarePluginKind('ownerlessKind');
		registerBlockKind(kind, minimal);
		augmentBlockKind(kind, { renderImagesAsWidgets: true });
		expect(tryGetBlockKindDescriptor(kind)?.renderImagesAsWidgets).toBe(true);
	});
});

describe('augmentBuiltin: the one allowed built-in wire-up', () => {
	it('merges into a built-in descriptor where augmentBlockKind refuses', () => {
		const original = tryGetBlockKindDescriptor('paragraph')!;
		try {
			augmentBuiltin('paragraph', { renderImagesAsWidgets: false });
			expect(tryGetBlockKindDescriptor('paragraph')?.renderImagesAsWidgets).toBe(false);
		} finally {
			augmentBuiltin('paragraph', { renderImagesAsWidgets: original.renderImagesAsWidgets });
		}
	});
});
