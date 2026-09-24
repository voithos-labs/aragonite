import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installPlugins } from '$lib';
import type { EditorContext } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	SLASH_COMMANDS_MENU,
	SLASH_COMMANDS_OPEN,
	slashCommandsPlugin
} from '$lib/plugins/slash-commands';
import { getCommand, resolveGlobalBinding } from '$lib/schema/commands';
import { eventToChord } from '$lib/schema/keybindings';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

const slashKey = {
	key: '/',
	ctrlKey: true,
	metaKey: false,
	altKey: false,
	shiftKey: false
} as KeyboardEvent;

beforeEach(() => resetPluginPlatformForTests());

describe('slashCommands.open', () => {
	it('opens the list through the editor that dispatched it, narrowed by the argument', () => {
		installPlugins([slashCommandsPlugin()]);
		const open = vi.fn(() => true);
		const editor = { inlineMenus: { open } } as unknown as EditorContext;
		const run = getCommand(SLASH_COMMANDS_OPEN as never)!;
		const dispatch = (arg?: unknown) =>
			run({
				history: { requestUndo() {}, requestRedo() {} },
				activation: everyInstalledPlugin,
				pluginEditor: () => editor,
				arg
			});

		expect(dispatch('table')).toBe(true);
		expect(dispatch()).toBe(true);
		expect(dispatch(3)).toBe(true);
		expect(open.mock.calls).toEqual([
			[SLASH_COMMANDS_MENU, { query: 'table' }],
			[SLASH_COMMANDS_MENU, { query: undefined }],
			[SLASH_COMMANDS_MENU, { query: undefined }]
		]);
	});

	it('is bound to the Mod+/ a slash keydown with Ctrl or Cmd makes', () => {
		installPlugins([slashCommandsPlugin()]);
		const chord = eventToChord(slashKey);
		expect(chord).toBe('Mod+/');
		expect(resolveGlobalBinding(chord!, undefined, everyInstalledPlugin)?.command).toBe(
			SLASH_COMMANDS_OPEN
		);
	});

	it('refuses a host row that neither inserts nor runs', () => {
		const neither = { id: 'odd', label: 'Odd' } as never;
		expect(() => slashCommandsPlugin({ entries: [neither] })).toThrow(/odd/);
	});
});
