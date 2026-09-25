import { describe, it, expect, afterEach } from 'vitest';
import { mintCommandId, isPluginCommandId } from '$lib/schema/command-id';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

afterEach(() => __resetSchemaRegistriesForTests());

/** Run `mint` inside the setup of a plugin called `name`, so the plugin owns what it creates. */
function asPlugin(name: string, mint: () => void): void {
	installPlugins([definePlugin({ name, setup: mint })]);
}

describe('command-id create', () => {
	it('creates a branded id and reports it as a plugin id', () => {
		const id = mintCommandId('callout.setKind');
		expect(id).toBe('callout.setKind');
		expect(isPluginCommandId(id)).toBe(true);
	});

	it('does not report a built-in command id as a plugin id', () => {
		expect(isPluginCommandId('block.split')).toBe(false);
		expect(isPluginCommandId('history.undo')).toBe(false);
	});

	it('rejects a second create of the same name (plugin-vs-plugin)', () => {
		mintCommandId('callout.setKind');
		expect(() => mintCommandId('callout.setKind')).toThrow(/already taken/i);
	});

	it('lets the same owner re-create a name (one command shared across its kinds)', () => {
		// The registry key is (kind, name), so one name used across several of a plugin's own kinds
		// is fine, and asking again returns the branded id rather than throwing.
		asPlugin('callouts', () => {
			expect(mintCommandId('callout.toggle')).toBe('callout.toggle');
			expect(mintCommandId('callout.toggle')).toBe('callout.toggle');
		});
	});

	it('still throws cross-plugin, naming the prior owner', () => {
		asPlugin('callouts', () => void mintCommandId('callout.toggle'));
		expect(() => asPlugin('intruder', () => void mintCommandId('callout.toggle'))).toThrow(
			/already taken by plugin "callouts"/
		);
	});

	it('throws on an unattributed re-create (no installing plugin)', () => {
		mintCommandId('callout.toggle');
		expect(() => mintCommandId('callout.toggle')).toThrow(/already taken/i);
	});

	it('rejects a name colliding with a built-in command id', () => {
		expect(() => mintCommandId('block.split')).toThrow(/built-in/i);
		expect(() => mintCommandId('history.undo')).toThrow(/built-in/i);
	});

	it('rejects malformed names', () => {
		for (const bad of [
			'',
			'has space',
			'1leading',
			'Upper',
			'.leading',
			'trailing.',
			'double..dot'
		]) {
			expect(() => mintCommandId(bad)).toThrow(/invalid/i);
		}
	});
});
