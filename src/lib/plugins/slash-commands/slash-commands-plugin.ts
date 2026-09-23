/**
 * Slash commands: `/` at the start of a line or after a space lists the blocks to insert, three
 * heading levels and the host's own rows. Built on public API alone: an inline-menu source, the
 * insert catalogue, and a global command (`Mod+/`) that types the `/` for a keyboard or touch user.
 */

import { definePlugin, registerGlobalCommand, type EditorPlugin } from '$lib/plugin';
import {
	createSlashSource,
	SLASH_COMMANDS_MENU,
	type SlashCommandEntry,
	type SlashCommandsOptions
} from './slash-source';

/** `runCommand(SLASH_COMMANDS_OPEN, 'table')` opens the list already narrowed to its argument. */
export const SLASH_COMMANDS_OPEN = 'slashCommands.open';

/**
 * `options` are the default for every editor; an editor's `{ plugin, options }` entry in the
 * `plugins` prop replaces them for that editor.
 */
export function slashCommandsPlugin(options: SlashCommandsOptions = {}): EditorPlugin {
	checkEntries(options.entries);
	return definePlugin<SlashCommandsOptions | undefined>({
		name: 'slash-commands',
		setup(ctx) {
			registerGlobalCommand(
				SLASH_COMMANDS_OPEN,
				(editor, arg) =>
					editor.inlineMenus.open(SLASH_COMMANDS_MENU, {
						query: typeof arg === 'string' ? arg : undefined
					}),
				{ chord: 'Mod+/' }
			);
			ctx.onEditor((editor) => {
				checkEntries(editor.options?.entries);
				const handle = editor.inlineMenus.addSource(
					createSlashSource(editor, () => editor.options ?? options)
				);
				return () => handle.dispose();
			});
		}
	});
}

/** A row that neither inserts nor runs would do nothing when picked, so it is refused up front. */
function checkEntries(entries: readonly SlashCommandEntry[] | undefined): void {
	for (const entry of entries ?? []) {
		if ((entry.insert === undefined) === (entry.run === undefined)) {
			throw new Error(
				`slashCommandsPlugin: entry '${entry.id}' needs exactly one of insert and run`
			);
		}
	}
}
