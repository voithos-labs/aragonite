import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	registerBlockKind,
	augmentBlockKind,
	augmentBuiltin,
	tryGetBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

const minimal = {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false
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
