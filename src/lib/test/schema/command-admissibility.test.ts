// The check behind `EditorInstance.canRunCommand`, asked where commands are dispatched. What
// matters is that the two agree: an answer that disagrees with what running the command then does
// is a greyed-out button lying about the click under it.
import { describe, it, expect, afterEach } from 'vitest';
import {
	canRunCommandById,
	runCommandById,
	dispatchKeyCommand,
	registerBlockCommand,
	__resetBlockCommandsForTests,
	type CommandDispatchContext,
	type KindCommandTarget
} from '$lib/schema/block-commands';
import { __removePluginCommandsForTests } from '$lib/schema/commands';
import { TOOLBAR_COMMANDS } from '$lib/index';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { AnyCommandId } from '$lib/schema/command-id';
import type { NodeView } from '$lib/core/node-views';
import type { PresentationMode } from '$lib/presentation-mode';
import { allowDevWarns } from '../support/warn-gate';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

afterEach(() => {
	__resetBlockCommandsForTests();
	__removePluginCommandsForTests();
});

function context(over: Partial<CommandDispatchContext> = {}): CommandDispatchContext {
	return {
		history: { requestUndo: () => {}, requestRedo: () => {} },
		activation: everyInstalledPlugin,
		getPresentationMode: () => 'source',
		isCrossBlockRange: () => false,
		crossBlockCommands: undefined,
		...over
	};
}

/** A focused block that answers every built-in id, so the answer comes from the dispatch alone. */
const surface = (): KindCommandTarget => ({ kind: 'paragraph', runCommand: () => true });

/** The same block once it resolves a plugin command: the level the check must not redo itself. */
const mintedSurface = (): KindCommandTarget => ({
	...surface(),
	getCommandContext: () => ({
		node: { kind: 'paragraph', leadingTrivia: '', raw: '' } as unknown as NodeView,
		updateMetadata: () => {}
	})
});

const reading = (): PresentationMode => 'reading';
const TOOLBAR_IDS = Object.values(TOOLBAR_COMMANDS);

describe('the toolbar scenario', () => {
	it('a collapsed caret admits every published toolbar id', () => {
		for (const id of TOOLBAR_IDS) expect(canRunCommandById(id, surface(), context())).toBe(true);
	});

	// No router passed in, which is what an older construction of the checks hands the dispatch:
	// the rewrites decline rather than falling through to the focused block's own offsets.
	it('a painted range with no cross-block branch declines the rewrites and nothing else', () => {
		const ctx = context({ isCrossBlockRange: () => true });
		for (const id of TOOLBAR_IDS) expect(canRunCommandById(id, surface(), ctx)).toBe(false);
		expect(canRunCommandById('block.split', surface(), ctx)).toBe(true);
		expect(canRunCommandById('history.undo', null, ctx)).toBe(true);
	});

	it('reading mode declines everything; an unfocused document declines the block-local half', () => {
		const inReading = context({ getPresentationMode: reading });
		expect(canRunCommandById('format.toggleStrong', surface(), inReading)).toBe(false);
		expect(canRunCommandById('history.undo', null, inReading)).toBe(false);
		// The gap caret's shape: no focused block, the global commands still available.
		expect(canRunCommandById('format.toggleStrong', null, context())).toBe(false);
		expect(canRunCommandById('history.undo', null, context())).toBe(true);
	});

	it('an id the entry point cannot reach is never admitted: unknown, or created with no context', () => {
		const minted = registerBlockCommand('paragraph', 'demo.minted', () => true);
		expect(canRunCommandById(minted, surface(), context())).toBe(false);
		expect(canRunCommandById('nope.nope' as AnyCommandId, surface(), context())).toBe(false);
		// Whether it can run is the target's to answer: one resolving the plugin handler allows it.
		expect(canRunCommandById(minted, mintedSurface(), context())).toBe(true);
	});
});

describe('the read agrees with the dispatch it describes', () => {
	// Miss-analysis: every scenario drove a target with no `getCommandContext`, the one shape where
	// working the levels out again gives exactly the dispatch's answer, so the check's missing
	// plugin-command level agreed everywhere the matrix looked.
	it('every (id, scenario) verdict is what the entry point then answers', () => {
		const minted = registerBlockCommand('paragraph', 'demo.agree', () => true);
		const scenarios = [
			{ name: 'collapsed caret', ctx: () => context(), target: surface },
			{
				name: 'cross-block range, no arm',
				ctx: () => context({ isCrossBlockRange: () => true }),
				target: surface
			},
			{
				name: 'cross-block range, arm wired',
				ctx: () =>
					context({
						isCrossBlockRange: () => true,
						crossBlockCommands: {
							canRun: (id) => id.startsWith('format.'),
							run: (id) => id.startsWith('format.'),
							isActive: () => false
						}
					}),
				target: surface
			},
			{
				name: 'reading mode',
				ctx: () => context({ getPresentationMode: reading }),
				target: surface
			},
			{ name: 'nothing focused', ctx: () => context(), target: () => null },
			{ name: 'minted-capable surface', ctx: () => context(), target: mintedSurface }
		];
		const ids: AnyCommandId[] = [
			...TOOLBAR_IDS,
			'block.split',
			'history.undo',
			minted,
			'nope.nope' as AnyCommandId
		];

		for (const scenario of scenarios) {
			for (const id of ids) {
				const ctx = scenario.ctx();
				const target = scenario.target();
				const verdict = canRunCommandById(id, target, ctx);
				expect(runCommandById(id, undefined, target, ctx), `${id} @ ${scenario.name}`).toBe(
					verdict
				);
			}
		}
		// The ids no level resolves do nothing at every block that had a level to try.
		allowDevWarns(['commands']);
	});

	it('predicts the chord path too, since both meet the same admissibility', () => {
		const ctx = context({ isCrossBlockRange: () => true });
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Alt+G', command: 'format.toggleStrong', kind: 'paragraph' }
		]);
		expect(canRunCommandById('format.toggleStrong', surface(), ctx)).toBe(false);
		expect(dispatchKeyCommand('Mod+Alt+G', surface(), ctx, overrides)).toBe(false);

		const collapsed = context();
		expect(canRunCommandById('format.toggleStrong', surface(), collapsed)).toBe(true);
		expect(dispatchKeyCommand('Mod+Alt+G', surface(), collapsed, overrides)).toBe(true);
	});
});
