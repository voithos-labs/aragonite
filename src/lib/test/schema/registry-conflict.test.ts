import { describe, expect, it } from 'vitest';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import {
	registerBlockKind,
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor
} from '#lib/schema/block-kind-descriptor.js';
import {
	registerBlockComponent,
	getBlockComponent,
	type BlockComponentEntry
} from '#lib/schema/block-component-registry.js';
import {
	registerBlockOpener,
	listRegisteredOpeners,
	type BlockOpener
} from '#lib/schema/block-openers.js';
import { registerCommand, getCommand } from '#lib/schema/commands.js';
import { __resetSchemaRegistriesForTests } from '#lib/schema/registry-reset.js';
import { testClosure } from '#lib/test/support/closure.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';

const minimal = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
} as const;

// Guard fires on registry.has before the entry is read, so a stub entry is enough.
const stubComponent = {} as BlockComponentEntry;
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

	it('registerBlockComponent throws on a duplicate registration', () => {
		const kind = declarePluginKind('conflict-component');
		registerBlockComponent(kind, stubComponent);
		expect(() => registerBlockComponent(kind, stubComponent)).toThrow(/already registered/i);
	});

	it('registerBlockOpener throws on a duplicate registration', () => {
		const kind = declarePluginKind('conflict-opener');
		registerBlockOpener(kind, stubOpener);
		expect(() => registerBlockOpener(kind, stubOpener)).toThrow(/already registered/i);
	});

	it('registerCommand throws on a built-in re-registration', () => {
		expect(() => registerCommand('history.undo', () => true)).toThrow(/already registered/i);
	});
});

describe('__resetSchemaRegistriesForTests', () => {
	it('removes plugin registrations across every registry but keeps built-ins', () => {
		const kind = declarePluginKind('ephemeral-kind');
		registerBlockKind(kind, minimal);
		registerBlockComponent(kind, stubComponent);
		registerBlockOpener(kind, stubOpener);

		__resetSchemaRegistriesForTests();

		expect(tryGetBlockKindDescriptor(kind)).toBeUndefined();
		expect(getBlockComponent(kind, everyInstalledPlugin)).toBeUndefined();
		expect(listRegisteredOpeners().some((o) => o.kind === kind)).toBe(false);

		expect(getBlockKindDescriptor('paragraph')).toBeDefined();
		expect(getCommand('history.undo', everyInstalledPlugin)).toBeDefined();

		// Declared-kind set cleared, so the name is re-declarable.
		expect(() => declarePluginKind('ephemeral-kind')).not.toThrow();
	});
});
