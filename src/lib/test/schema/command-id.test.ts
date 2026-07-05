import { describe, it, expect, afterEach } from 'vitest';
import {
	mintCommandId,
	isPluginCommandId,
	__resetMintedCommandIdsForTests
} from '$lib/schema/command-id';

afterEach(() => __resetMintedCommandIdsForTests());

describe('command-id mint', () => {
	it('mints a branded id and reports it as a plugin id', () => {
		const id = mintCommandId('callout.setKind');
		expect(id).toBe('callout.setKind');
		expect(isPluginCommandId(id)).toBe(true);
	});

	it('does not report a built-in command id as a plugin id', () => {
		expect(isPluginCommandId('block.split')).toBe(false);
		expect(isPluginCommandId('history.undo')).toBe(false);
	});

	it('rejects a second mint of the same name (plugin-vs-plugin)', () => {
		mintCommandId('callout.setKind');
		expect(() => mintCommandId('callout.setKind')).toThrow(/already minted/i);
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
