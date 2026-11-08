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
	const callouts = { plugin: 'callouts', claims: { colons: ['note', 'tip'] } };
	const notes = { plugin: 'notes', claims: { colons: ['note'] } };
	it.each([
		['callouts first', [callouts, notes], 'callouts', 'notes'],
		['notes first', [notes, callouts], 'notes', 'callouts']
	])('leaves out the later plugin to claim a `:::` name, %s', (_, claimants, first, later) => {
		expect(refuse(claimants)).toEqual({
			refused: [later],
			messages: [
				`plugin '${later}' shares the \`:::\` name "note" with '${first}', listed before it, so it's left out`
			]
		});
	});

	it('leaves out a plugin claiming the chord search takes, however it is spelled', () => {
		expect(refuse([{ plugin: 'finder', claims: { chords: ['Mod+f'] } }])).toEqual({
			refused: ['finder'],
			messages: ['plugin \'finder\' claims the chord "Mod+f", which search takes']
		});
	});

	// Miss-analysis: no row claimed a malformed chord, which also fired the keymap's dev warning.
	it('reports a malformed chord once, with what is wrong with it', () => {
		expect(refuse([{ plugin: 'keys', claims: { chords: ['Ctrl+B'] } }])).toEqual({
			refused: ['keys'],
			messages: [
				'plugin \'keys\' claims the chord "Ctrl+B", which isn\'t one: unrecognized modifier "Ctrl" (use Mod/Alt/Shift)'
			]
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
