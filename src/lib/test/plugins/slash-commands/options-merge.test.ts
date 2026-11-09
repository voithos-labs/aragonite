// Miss-analysis: every slash test built its options by hand, so none sent an editor's entry
// through the plugin, where it replaced the factory's options whole.
import { describe, expect, it } from 'vitest';
import { slashCommands, type SlashCommandEntry } from '#packages/slash-commands/src/index.js';
import { slashHarness } from './slash-harness';

const stamp: SlashCommandEntry = { id: 'stamp', label: 'Stamp', insert: 'ok' };

describe('slash-commands options laid over each other', () => {
	it('merge field by field: exclude alone keeps the earlier rows', async () => {
		const h = slashHarness('', slashCommands({ entries: [stamp] })({ exclude: ['table'] }));
		await h.type('/');
		expect(h.rows()).toContain('Stamp');
		expect(h.rows()).toContain('Quote');
		expect(h.rows()).not.toContain('Table');
	});

	it('replace an array field whole, so an empty entries list drops the earlier rows', async () => {
		const h = slashHarness('', slashCommands({ entries: [stamp] })({ entries: [] }));
		await h.type('/');
		expect(h.rows()).toContain('Quote');
		expect(h.rows()).not.toContain('Stamp');
	});
});
