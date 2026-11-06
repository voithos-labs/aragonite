// What two plugins on one editor can't both claim.
import { describe, expect, it } from 'vitest';
import { refusedClaims, type PluginClaims } from '#lib/schema/plugin-claims.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';

function refuse(claimants: { plugin: string; claims: PluginClaims }[]) {
	const errors: PluginError[] = [];
	const refused = refusedClaims(claimants, (error) => errors.push(error));
	return { refused: [...refused], messages: errors.map((e) => (e.cause as Error).message) };
}

describe('refusedClaims', () => {
	it('leaves out the second plugin to claim a `:::` name', () => {
		expect(
			refuse([
				{ plugin: 'callouts', claims: { colons: ['note', 'tip'] } },
				{ plugin: 'notes', claims: { colons: ['note'] } }
			])
		).toEqual({
			refused: ['notes'],
			messages: ["plugin 'notes' claims the `:::` name \"note\", which 'callouts' already has"]
		});
	});

	it('leaves out a plugin claiming the chord search takes, however it is spelled', () => {
		expect(refuse([{ plugin: 'finder', claims: { chords: ['Mod+f'] } }])).toEqual({
			refused: ['finder'],
			messages: ['plugin \'finder\' claims the chord "Mod+f", which search takes']
		});
	});

	it('leaves out the second plugin to claim an inline prefix, and only it', () => {
		expect(
			refuse([
				{ plugin: 'wiki', claims: { prefixes: ['[['] } },
				{ plugin: 'links', claims: { prefixes: ['[['] } },
				{ plugin: 'tags', claims: { prefixes: ['#'] } }
			]).refused
		).toEqual(['links']);
	});

	it('lets a refused plugin keep nothing it claimed', () => {
		expect(
			refuse([
				{ plugin: 'a', claims: { colons: ['x'] } },
				{ plugin: 'b', claims: { colons: ['y', 'x'] } },
				{ plugin: 'c', claims: { colons: ['y'] } }
			]).refused
		).toEqual(['b']);
	});
});
