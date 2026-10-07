import { beforeEach, describe, it, expect } from 'vitest';
import type { PluginBlockKind } from '#lib/core/nodes.js';
import { registerBlockCommand, getBlockCommand } from '#lib/schema/block-commands.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';

let note: PluginBlockKind;
let noteA: PluginBlockKind;
let noteB: PluginBlockKind;
beforeEach(() => {
	note = declarePluginKind('note');
	noteA = declarePluginKind('note-a');
	noteB = declarePluginKind('note-b');
});

describe('block-command registry', () => {
	it('creates a branded id and resolves the handler by (kind,id)', () => {
		const id = registerBlockCommand(note, 'callout.setKind', () => true);
		expect(typeof id).toBe('string');
		expect(getBlockCommand(note, id, everyInstalledPlugin)).toBeTypeOf('function');
	});

	it('is register-once: a duplicate (kind,name) throws', () => {
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
		expect(getBlockCommand('paragraph', id, everyInstalledPlugin)).toBeUndefined();
	});

	// Command ids are global by name, so only recording the owner lets one installer create the
	// same id again for another of its kinds. Driven through the real install path to check that.
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
		expect(getBlockCommand(noteA, idA!, everyInstalledPlugin)).toBeTypeOf('function');
		expect(getBlockCommand(noteB, idB!, everyInstalledPlugin)).toBeTypeOf('function');
	});
});
