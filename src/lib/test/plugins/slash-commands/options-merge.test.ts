// Miss-analysis: every slash test built its options by hand, so none sent an editor's entry
// through the plugin, where it replaced the factory's options whole.
import { describe, expect, it } from 'vitest';
import { slashCommandsPlugin, type SlashCommandEntry } from '#lib/plugins/slash-commands/index.js';
import { slashPluginHarness } from './slash-harness';

const stamp: SlashCommandEntry = { id: 'stamp', label: 'Stamp', insert: 'ok' };

describe("an editor's slash-commands entry", () => {
	it("merges over the factory's options field by field: exclude alone keeps the factory's rows", async () => {
		const plugin = slashCommandsPlugin({ entries: [stamp] });
		const h = slashPluginHarness('', { plugin, options: { exclude: ['table'] } });
		await h.type('/');
		expect(h.rows()).toContain('Stamp');
		expect(h.rows()).toContain('Quote');
		expect(h.rows()).not.toContain('Table');
	});

	it('replaces an array field whole, so an empty entries list drops the factory rows', async () => {
		const plugin = slashCommandsPlugin({ entries: [stamp] });
		const h = slashPluginHarness('', { plugin, options: { entries: [] } });
		await h.type('/');
		expect(h.rows()).toContain('Quote');
		expect(h.rows()).not.toContain('Stamp');
	});

	it('runs on the factory options when an entry row is malformed, instead of dropping the menu', async () => {
		const plugin = slashCommandsPlugin({ entries: [stamp] });
		const bad = { id: 'bad', label: 'Bad' } as SlashCommandEntry;
		const reports: unknown[] = [];
		const h = slashPluginHarness('', { plugin, options: { entries: [bad] } }, (error) =>
			reports.push(error)
		);
		await h.type('/');
		expect(h.rows()).toContain('Stamp');
		expect(h.rows()).not.toContain('Bad');
		expect(String((reports[0] as Error).message)).toMatch(
			/'bad' needs exactly one of insert and run/
		);
	});
});
