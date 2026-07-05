import { describe, it, expect, afterEach } from 'vitest';
import {
	registerBlockCommand,
	getBlockCommand,
	__resetBlockCommandsForTests
} from '$lib/schema/block-commands';
import { declarePluginKind } from '$lib/schema/plugin-kind';

// A plugin kind is a branded string; the bare literal 'note' is not assignable
// to AnyBlockKind. Declared once — the reset clears the command registries, not
// the plugin-kind declarations (a per-test declare would double-throw).
const note = declarePluginKind('note');

afterEach(() => __resetBlockCommandsForTests());

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
});
