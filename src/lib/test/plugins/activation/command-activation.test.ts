// Miss-analysis: no case asked `runCommand` for a plugin's id in an editor that left it out.
import { describe, expect, it } from 'vitest';
import { runCommandById, registerBlockCommand } from '#lib/schema/block-commands.js';
import type { CommandDispatchContext, KindCommandTarget } from '#lib/schema/block-commands.js';
import { definePlugin, installPlugins, type EditorContext } from '#lib/schema/plugin-install.js';
import { activationFor, type PluginActivation } from '#lib/schema/plugin-activation.js';
import type { AnyCommandId } from '#lib/schema/command-id.js';
import { commandContext } from '#lib/test/harness/command-context.js';

// A plugin context for any name, so only the command registry's own activation check can refuse.
function context(activation: PluginActivation): CommandDispatchContext {
	return commandContext({ pluginEditor: () => ({ editorId: 'e1' }) as EditorContext, activation });
}

const paragraph: KindCommandTarget = {
	kind: 'paragraph',
	runCommand: () => false,
	getCommandContext: () => ({
		node: { kind: 'paragraph', leadingTrivia: '', raw: 'x\n' },
		updateMetadata: () => {},
		replaceRaw: () => {}
	})
};

function installCommand(ran: string[]): AnyCommandId {
	let block: AnyCommandId | undefined;
	installPlugins([
		definePlugin({
			name: 'commander',
			setup() {
				block = registerBlockCommand('paragraph', 'commander.block', () => {
					ran.push('block');
					return true;
				});
			}
		})
	]);
	return block!;
}

describe("runCommand reaches a plugin's command only where the plugin is listed", () => {
	it('runs the block command nowhere in an editor that left the plugin out', () => {
		const ran: string[] = [];
		const block = installCommand(ran);
		const unlisted = context(activationFor([]));
		expect(runCommandById(block, undefined, paragraph, unlisted)).toBe(false);
		expect(ran).toEqual([]);
	});

	it('runs it in an editor that lists it', () => {
		const ran: string[] = [];
		const block = installCommand(ran);
		const listed = context(activationFor(['commander']));
		expect(runCommandById(block, undefined, paragraph, listed)).toBe(true);
		expect(ran).toEqual(['block']);
	});
});
