import { it, expect, beforeEach } from 'vitest';
import { dispatchKeyCommand } from '$lib/schema/block-commands';
import {
	registerGlobalCommand,
	__resetPluginGlobalCommandsForTests
} from '$lib/schema/global-commands';
import {
	__resetPluginGlobalKeymapForTests,
	__removePluginCommandsForTests
} from '$lib/schema/commands';
import { __resetMintedCommandIdsForTests } from '$lib/schema/command-id';
import type { EditorContext } from '$lib/schema/plugin-install';

beforeEach(() => {
	__resetPluginGlobalCommandsForTests();
	__resetPluginGlobalKeymapForTests();
	__removePluginCommandsForTests();
	__resetMintedCommandIdsForTests();
});

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
		{
			history: { requestUndo() {}, requestRedo() {} },
			pluginEditor: () => editor,
			getPresentationMode: () => 'source' as const,
			isCrossBlockRange: () => false
		},
		undefined,
		(r) => reports.push(r)
	);
	expect(handled).toBe(true);
	expect(reports).toHaveLength(1);
});
