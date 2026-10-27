import { describe, expect, it } from 'vitest';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import {
	blockViewFor,
	registerBlockKind,
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	openerRecords
} from '#lib/schema/block-kind-descriptor.js';
import type { BlockOpener } from '#lib/schema/block-openers.js';
import { registerCommand, getCommand } from '#lib/schema/commands.js';
import { __resetSchemaRegistriesForTests } from '#lib/schema/registry-reset.js';
import { testClosure } from '#lib/test/harness/closure.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { testView } from '#lib/test/harness/test-view.js';

const minimal = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure,
	view: testView()
} as const;

const stubOpener: BlockOpener = { priority: 999, tryOpen: () => null, interruptsParagraph: false };

describe('schema registries are register-once', () => {
	it('registerBlockKind throws on a built-in re-registration', () => {
		expect(() => registerBlockKind('paragraph', minimal)).toThrow(/already registered/i);
	});

	it('registerBlockKind throws on a duplicate plugin kind', () => {
		const kind = declarePluginKind('conflict-kind');
		registerBlockKind(kind, minimal);
		expect(() => registerBlockKind(kind, minimal)).toThrow(/already registered/i);
	});

	it('registerCommand throws on a built-in re-registration', () => {
		expect(() => registerCommand('history.undo', () => true)).toThrow(/already registered/i);
	});
});

describe('__resetSchemaRegistriesForTests', () => {
	it('removes plugin registrations across every registry but keeps built-ins', () => {
		const kind = declarePluginKind('ephemeral-kind');
		registerBlockKind(kind, { ...minimal, opener: stubOpener });

		__resetSchemaRegistriesForTests();

		expect(tryGetBlockKindDescriptor(kind)).toBeUndefined();
		expect(blockViewFor(kind, everyInstalledPlugin)).toBeUndefined();
		expect(openerRecords().some((o) => o.key === kind)).toBe(false);

		expect(getBlockKindDescriptor('paragraph')).toBeDefined();
		expect(getCommand('history.undo', everyInstalledPlugin)).toBeDefined();

		// Declared-kind set cleared, so the name is re-declarable.
		expect(() => declarePluginKind('ephemeral-kind')).not.toThrow();
	});
});
