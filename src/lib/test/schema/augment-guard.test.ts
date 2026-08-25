import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind, declaredPluginKind } from '$lib/schema/plugin-kind';
import {
	registerBlockKind,
	augmentBlockKind,
	augmentBuiltin,
	tryGetBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

const minimal = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
} as const;

afterEach(() => __resetSchemaRegistriesForTests());

describe('augmentBlockKind rejects built-in kinds', () => {
	it('throws when the kind is a built-in — a plugin cannot rewrite it', () => {
		// `editable: true` is a no-op merge, so a missing throw cannot corrupt paragraph.
		expect(() => augmentBlockKind('paragraph', { editable: true })).toThrow(/built-in/i);
	});

	it('still throws for an unregistered plugin kind (no accidental creation)', () => {
		const kind = declarePluginKind('neverRegistered');
		expect(() => augmentBlockKind(kind, { editable: false })).toThrow(/no base descriptor/i);
	});

	it('merges into a registered plugin kind — the surviving public path', () => {
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

	it('augmentBuiltin shares the gate — a built-in leaf refuses container fields', () => {
		expect(() => augmentBuiltin('paragraph', { container: { rebuildRaw: () => {} } })).toThrow(
			/registered as a leaf/
		);
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

		// No install is active here (currentInstallingPlugin() is null), so this is a
		// consumer/harness augment of a plugin-owned kind — still a silent override.
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

describe('augmentBuiltin — the sanctioned built-in wire-up seam', () => {
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
