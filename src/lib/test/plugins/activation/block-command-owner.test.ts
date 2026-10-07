// Miss-analysis: every block-command test registered the command in the plugin that declared the
// kind, so the handler's editor and the error report reading the kind's plugin never showed.
import { beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, installPlugins, type EditorContext } from '$lib/schema/plugin-install';
import { declarePluginKind, declaredPluginKind } from '$lib/schema/plugin-kind';
import {
	registerBlockCommand,
	runCommandById,
	type BlockCommandContext,
	type KindCommandTarget
} from '$lib/schema/block-commands';
import type { AnyCommandId } from '$lib/schema/command-id';
import { buildLeafCommandContext } from '$lib/components/blocks/editable-leaf';
import { buildContainerKindTarget } from '$lib/editor-actions/plugin/container';
import { createEditorEvents, emitCommandError } from '$lib/editor-events';
import type { CstNode } from '$lib/core/nodes';
import { commandContext } from '$lib/test/support/command-context';

const KIND = 'owned-block';
let commandId: AnyCommandId;
let seen: BlockCommandContext | undefined;

beforeEach(() => {
	seen = undefined;
	installPlugins([
		definePlugin({ name: 'declarer', setup: () => void declarePluginKind(KIND) }),
		definePlugin({
			name: 'commander',
			setup() {
				commandId = registerBlockCommand(declaredPluginKind(KIND), 'commander.run', (ctx) => {
					seen = ctx;
					throw new Error('commander failed');
				});
			}
		})
	]);
});

const node = (): CstNode => ({ kind: declaredPluginKind(KIND), leadingTrivia: '', raw: '' });

const targets: [string, () => KindCommandTarget][] = [
	[
		'a leaf',
		() => ({
			kind: declaredPluginKind(KIND),
			getCommandContext: () =>
				buildLeafCommandContext(
					{ getNode: node, getIndex: () => 0 },
					{ updateBlockMetadata: async () => true }
				)
		})
	],
	['a container', () => buildContainerKindTarget({ getNode: node }, async () => {})]
];

describe('a block command answers to the plugin that registered it, on another plugin’s kind', () => {
	it.each(targets)(
		'on %s: the handler’s editor and the error report name that plugin',
		(_tier, target) => {
			const contexts: Record<string, EditorContext> = {
				declarer: { options: { from: 'declarer' } } as unknown as EditorContext,
				commander: { options: { from: 'commander' } } as unknown as EditorContext
			};
			const events = createEditorEvents();
			const reported: (string | undefined)[] = [];
			events.on('error', (payload) => {
				if (payload.origin === 'command') reported.push(payload.context?.plugin);
			});

			runCommandById(
				commandId,
				undefined,
				target(),
				commandContext({
					pluginEditor: (name) => contexts[name],
					onCommandError: (report) => emitCommandError(events, report)
				})
			);

			expect(seen?.editor?.options).toEqual({ from: 'commander' });
			expect(reported).toEqual(['commander']);
		}
	);
});

describe('a block command registered outside any plugin', () => {
	it('runs with the editor’s base context', () => {
		const base = { options: { from: 'base' } } as unknown as EditorContext;
		const id = registerBlockCommand(declaredPluginKind(KIND), 'loose.run', (ctx) => {
			seen = ctx;
			return true;
		});

		runCommandById(
			id,
			undefined,
			targets[1][1](),
			commandContext({ pluginEditor: (name) => (name === '' ? base : undefined) })
		);

		expect(seen?.editor).toBe(base);
	});
});
