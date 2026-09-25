// Miss-analysis: the activation suites pressed a plugin's chord in an editor that left it out,
// but no case asked `runCommand` for the plugin's id there, so a command registry that ignored
// the activation still passed.
import { afterEach, describe, expect, it } from 'vitest';
import { runCommandById, registerBlockCommand } from '$lib/schema/block-commands';
import type { CommandDispatchContext, KindCommandTarget } from '$lib/schema/block-commands';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import { definePlugin, installPlugins, type EditorContext } from '$lib/schema/plugin-install';
import { activationFor, type PluginActivation } from '$lib/schema/plugin-activation';
import type { AnyCommandId } from '$lib/schema/command-id';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

afterEach(() => __resetSchemaRegistriesForTests());

// A plugin context for any name, so only the command registry's own activation check can refuse.
function context(activation: PluginActivation): CommandDispatchContext {
	return {
		history: { requestUndo: () => {}, requestRedo: () => {} },
		pluginEditor: () => ({ editorId: 'e1' }) as EditorContext,
		activation,
		getPresentationMode: () => 'source',
		isCrossBlockRange: () => false,
		crossBlockCommands: undefined
	};
}

const paragraph: KindCommandTarget = {
	kind: 'paragraph',
	runCommand: () => false,
	getCommandContext: () => ({
		node: { kind: 'paragraph', leadingTrivia: '', raw: 'x\n' },
		updateMetadata: () => {}
	})
};

function installCommands(ran: string[]): { block: AnyCommandId; global: AnyCommandId } {
	let block: AnyCommandId | undefined;
	let global: AnyCommandId | undefined;
	installPlugins([
		definePlugin({
			name: 'commander',
			setup() {
				block = registerBlockCommand('paragraph', 'commander.block', () => {
					ran.push('block');
					return true;
				});
				global = registerGlobalCommand('commander.global', () => {
					ran.push('global');
					return true;
				});
			}
		})
	]);
	return { block: block!, global: global! };
}

describe("runCommand reaches a plugin's command only where the plugin is listed", () => {
	it('runs neither command in an editor that left the plugin out', () => {
		const ran: string[] = [];
		const ids = installCommands(ran);
		const unlisted = context(activationFor([]));
		expect(runCommandById(ids.block, undefined, paragraph, unlisted)).toBe(false);
		expect(runCommandById(ids.global, undefined, paragraph, unlisted)).toBe(false);
		expect(ran).toEqual([]);
	});

	it('runs both in an editor that lists it', () => {
		const ran: string[] = [];
		const ids = installCommands(ran);
		const listed = context(activationFor(['commander']));
		expect(runCommandById(ids.block, undefined, paragraph, listed)).toBe(true);
		expect(runCommandById(ids.global, undefined, paragraph, listed)).toBe(true);
		expect(ran).toEqual(['block', 'global']);
	});
});
