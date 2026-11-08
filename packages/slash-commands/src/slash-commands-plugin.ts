/**
 * Slash commands: `/` at the start of a line or after a space lists the blocks to insert, three
 * heading levels and the host's own rows. Built on public API alone: a caret menu over the
 * editor's insert rows, and a command (`Mod+/`) that opens it for a keyboard or touch user.
 */

import { command, definePlugin } from '@voithos-labs/aragonite/plugin';
import { slashMenu, type SlashCommandEntry, type SlashCommandsOptions } from './slash-source';

/** `slashCommands` with options gives the editor those rows; `editor.run('slash-commands/open',
 *  'table')` opens the list already narrowed to its argument. */
export const slashCommands = definePlugin<SlashCommandsOptions>({
	name: 'slash-commands',
	version: '0.11.5',
	editor: '0.11.5',
	validate: ({ entries }) => entriesProblem(entries),
	contributes(options) {
		const slash = slashMenu(options);
		const open = command<string | undefined>({
			id: 'open',
			title: 'Insert a block',
			chord: 'Mod+/',
			run: (editor, query) => editor.openMenu(slash, typeof query === 'string' ? query : undefined)
		});
		return { menus: [slash], commands: [open] };
	}
});

/** A row that neither inserts nor runs would do nothing when picked, so it is refused up front. */
function entriesProblem(entries: readonly SlashCommandEntry[] | undefined): string | undefined {
	const odd = entries?.find((entry) => (entry.insert === undefined) === (entry.run === undefined));
	return odd && `entry '${odd.id}' needs exactly one of insert and run`;
}
