import { describe, expect, it } from 'vitest';
import { slashCommands } from '#packages/slash-commands/src/index.js';
import { commandSpec } from '#lib/schema/plugin-command.js';
import { slashHarness } from './slash-harness';

describe('the slash-commands open command', () => {
	it('opens its own menu through the editor that runs it, narrowed by a string argument', () => {
		const h = slashHarness('');
		const opened: unknown[][] = [];
		const editor = { openMenu: (...args: unknown[]) => (opened.push(args), true) };
		const [open] = h.unit.contribution.commands!;
		const run = (arg?: unknown) => commandSpec(open)!.run(editor as never, arg);

		expect([run('table'), run(), run(3)]).toEqual([true, true, true]);
		const menu = h.unit.contribution.menus![0];
		expect(opened).toEqual([
			[menu, 'table'],
			[menu, undefined],
			[menu, undefined]
		]);
	});

	it('is bound to Mod+/', () => {
		const [open] = slashHarness('').unit.contribution.commands!;
		expect(commandSpec(open)!.chord).toBe('Mod+/');
	});

	it('reports a host row that neither inserts nor runs, and runs on the defaults', async () => {
		const reports: unknown[] = [];
		const neither = { id: 'odd', label: 'Odd' } as never;
		const h = slashHarness('', slashCommands({ entries: [neither] }), (error) =>
			reports.push(error)
		);
		expect(String((reports[0] as Error).message)).toMatch(
			/'odd' needs exactly one of insert and run/
		);
		await h.type('/');
		expect(h.rows()).toContain('Quote');
		expect(h.rows()).not.toContain('Odd');
	});
});
