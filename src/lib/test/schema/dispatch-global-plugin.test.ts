import { it, expect } from 'vitest';
import { dispatchKeyCommand } from '#lib/schema/block-commands.js';
import { registerGlobalCommand } from '#lib/schema/global-commands.js';
import type { EditorContext } from '#lib/schema/plugin-install.js';
import { commandContext } from '../support/command-context';

it('a plugin-global chord dispatches from an ordinary leaf and the sink receives a contained throw', () => {
	const editor = { editorId: 'e' } as never as EditorContext;
	const reports: unknown[] = [];
	registerGlobalCommand(
		'demo.throwing',
		() => {
			throw new Error('x');
		},
		{ chord: 'Mod+Shift+7' }
	);
	const handled = dispatchKeyCommand(
		'Mod+Shift+7',
		{ kind: 'paragraph', runCommand: () => false },
		commandContext({ pluginEditor: () => editor, onCommandError: (r) => reports.push(r) })
	);
	expect(handled).toBe(true);
	expect(reports).toHaveLength(1);
});
