import { describe, it, expect, afterEach } from 'vitest';
import {
	registerBlockCommand,
	getBlockCommand,
	__resetBlockCommandsForTests
} from '$lib/schema/block-commands';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	definePlugin,
	installPlugins,
	__resetInstalledPluginsForTests
} from '$lib/schema/plugin-install';

// Declared once at module scope: the reset clears the command registries but not the
// plugin-kind declarations, so a per-test declare would double-throw.
const note = declarePluginKind('note');
const noteA = declarePluginKind('note-a');
const noteB = declarePluginKind('note-b');

afterEach(() => {
	__resetBlockCommandsForTests();
	__resetInstalledPluginsForTests();
});

describe('block-command registry', () => {
	it('mints a branded id and resolves the handler by (kind,id)', () => {
		const id = registerBlockCommand(note, 'callout.setKind', () => true);
		expect(typeof id).toBe('string');
		expect(getBlockCommand(note, id)).toBeTypeOf('function');
	});

	it('is register-once — a duplicate (kind,name) throws', () => {
		registerBlockCommand(note, 'callout.setKind', () => true);
		expect(() => registerBlockCommand(note, 'callout.setKind', () => true)).toThrow(
			/register-once/i
		);
	});

	it('rejects a name colliding with a built-in command id', () => {
		expect(() => registerBlockCommand(note, 'block.split', () => true)).toThrow(/built-in/i);
	});

	it('returns undefined for an unregistered (kind,id)', () => {
		const id = registerBlockCommand(note, 'callout.setKind', () => true);
		expect(getBlockCommand('paragraph', id)).toBeUndefined();
	});

	// The mint is name-global, so only owner attribution lets one installer re-mint for
	// another of its kinds. Driven through the real install path to pin that thread.
	it('lets one plugin register the same command on two of its kinds', () => {
		let idA: ReturnType<typeof registerBlockCommand> | undefined;
		let idB: ReturnType<typeof registerBlockCommand> | undefined;
		const plugin = definePlugin({
			name: 'multi-kind',
			setup() {
				idA = registerBlockCommand(noteA, 'shared.toggle', () => true);
				idB = registerBlockCommand(noteB, 'shared.toggle', () => true);
			}
		});
		expect(() => installPlugins([plugin])).not.toThrow();
		expect(idA).toBeDefined();
		expect(getBlockCommand(noteA, idA!)).toBeTypeOf('function');
		expect(getBlockCommand(noteB, idB!)).toBeTypeOf('function');
	});
});
