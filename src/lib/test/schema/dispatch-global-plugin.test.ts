import { it, expect, beforeEach } from 'vitest';
import { dispatchKeyCommand } from '$lib/schema/block-commands';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import type { EditorContext } from '$lib/schema/plugin-install';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

beforeEach(() => {
	__resetSchemaRegistriesForTests();
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
			activation: everyInstalledPlugin,
			pluginEditor: () => editor,
			getPresentationMode: () => 'source' as const,
			isCrossBlockRange: () => false,
			crossBlockCommands: undefined
		},
		undefined,
		(r) => reports.push(r)
	);
	expect(handled).toBe(true);
	expect(reports).toHaveLength(1);
});
