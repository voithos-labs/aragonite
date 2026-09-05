// The id-keyed dispatch seam `EditorInstance.runCommand` and chord dispatch share. Pins the
// tier order and the two gates that must hold whatever invoked the command, so a door call and
// a chord press cannot diverge.
import { describe, it, expect, afterEach } from 'vitest';
import {
	runCommandById,
	dispatchKeyCommand,
	registerBlockCommand,
	__resetBlockCommandsForTests,
	type CommandDispatchContext,
	type KindCommandTarget
} from '$lib/schema/block-commands';
import {
	registerCommand,
	__removePluginCommandsForTests,
	type CommandId
} from '$lib/schema/commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { AnyCommandId } from '$lib/schema/command-id';
import type { PresentationMode } from '$lib/presentation-mode';
import { takeDevWarns } from '../support/warn-gate';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

afterEach(() => {
	__resetBlockCommandsForTests();
	__removePluginCommandsForTests();
});

let undos = 0;
function context(over: Partial<CommandDispatchContext> = {}): CommandDispatchContext {
	return {
		history: { requestUndo: () => void undos++, requestRedo: () => {} },
		activation: everyInstalledPlugin,
		getPresentationMode: () => 'source',
		isCrossBlockRange: () => false,
		crossBlockCommands: undefined,
		...over
	};
}

function target(ran: string[]): KindCommandTarget {
	return {
		kind: 'paragraph',
		runCommand: (id) => {
			ran.push(id);
			return true;
		}
	};
}

const reading = (): PresentationMode => 'reading';

describe('runCommandById tier order', () => {
	it('the global table wins over a block command registered under the same id', () => {
		const ranBlock: string[] = [];
		const id = registerBlockCommand('paragraph', 'demo.dual', () => {
			ranBlock.push('block');
			return true;
		});
		let globals = 0;
		registerCommand(id, () => {
			globals++;
			return true;
		});
		const surface: KindCommandTarget = {
			kind: 'paragraph',
			runCommand: () => false,
			getCommandContext: () => ({ node: { raw: '' } as never, updateMetadata: () => {} })
		};

		expect(runCommandById(id, undefined, surface, context())).toBe(true);
		// Same answer by chord: the door enters the seam the chord path resolves into.
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+K', command: id, kind: 'paragraph' }
		]);
		expect(dispatchKeyCommand('Mod+Shift+K', surface, context(), overrides)).toBe(true);

		expect(globals).toBe(2);
		expect(ranBlock).toEqual([]);
	});

	it('a global command runs with no focused surface; a block-local one declines', () => {
		const before = undos;
		expect(runCommandById('history.undo', undefined, null, context())).toBe(true);
		expect(undos).toBe(before + 1);
		expect(runCommandById('format.toggleStrong', undefined, null, context())).toBe(false);
	});

	it('an unknown id declines, dev-warning only once it had a surface to try', () => {
		const unknown = 'nope.nope' as AnyCommandId;
		expect(runCommandById(unknown, undefined, null, context())).toBe(false);
		expect(takeDevWarns()).toEqual([]);

		const ran: string[] = [];
		expect(runCommandById(unknown, undefined, target(ran), context())).toBe(false);
		expect(ran).toEqual([]);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['commands']);
	});
});

describe('runCommandById gates', () => {
	it('reading mode dead-keys the whole vocabulary, undo included', () => {
		const ran: string[] = [];
		const before = undos;
		const ctx = context({ getPresentationMode: reading });
		expect(runCommandById('history.undo', undefined, null, ctx)).toBe(false);
		expect(runCommandById('block.split', undefined, target(ran), ctx)).toBe(false);
		expect(undos).toBe(before);
		expect(ran).toEqual([]);
	});

	// Miss-analysis: the set had one member class and the census that guards it read the
	// `format.` prefix, so the fifth single-block rewrite — bound at the same keymaps, published
	// on `TOOLBAR_COMMANDS` — was structurally invisible to the guard AND to this case.
	it('a painted cross-block range declines every single-block rewrite and nothing else', () => {
		const ran: string[] = [];
		const ctx = context({ isCrossBlockRange: () => true });
		const rewrites: CommandId[] = [
			'format.toggleStrong',
			'format.toggleEmphasis',
			'format.toggleStrikethrough',
			'format.toggleCode',
			'link.openCard'
		];
		for (const id of rewrites) expect(runCommandById(id, undefined, target(ran), ctx)).toBe(false);
		expect(ran).toEqual([]);

		expect(runCommandById('block.split', undefined, target(ran), ctx)).toBe(true);
		expect(runCommandById('history.undo', undefined, null, ctx)).toBe(true);
		expect(ran).toEqual(['block.split']);
	});

	// The JS caller the required field cannot reach: absence must be loud, never a skipped
	// decline. TS callers are covered by the type; this pins what the runtime does.
	it('a gates object with no range getter throws rather than admitting the rewrite', () => {
		const gateless = { history: context().history } as unknown as CommandDispatchContext;
		expect(() => runCommandById('format.toggleStrong', undefined, target([]), gateless)).toThrow();
	});

	it('the range decline is id-keyed, so a rebound chord meets it too', () => {
		const ran: string[] = [];
		// The chord #107 never sees: a consumer moved the toggle off Mod+B.
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Alt+G', command: 'format.toggleStrong', kind: 'paragraph' },
			{ chord: 'Mod+Alt+L', command: 'link.openCard', kind: 'paragraph' }
		]);
		const ctx = context({ isCrossBlockRange: () => true });
		expect(dispatchKeyCommand('Mod+Alt+G', target(ran), ctx, overrides)).toBe(false);
		expect(dispatchKeyCommand('Mod+Alt+L', target(ran), ctx, overrides)).toBe(false);
		expect(ran).toEqual([]);
	});
});
