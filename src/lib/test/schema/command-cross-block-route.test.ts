// The dispatch's third answer to a painted range: hand it to the injected cross-block handler.
// Which ids take that path is the set's decision, whether they may is the router's, and a caller
// that passes no router must still decline rather than reach the focused block's own offsets.
import { describe, it, expect, vi } from 'vitest';
import {
	canRunCommandById,
	isCommandActiveById,
	runCommandById,
	type CommandDispatchContext,
	type CrossBlockCommandRouter,
	type KindCommandTarget
} from '$lib/schema/block-commands';
import { TOOLBAR_COMMANDS } from '$lib/schema/commands';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';

const TOGGLES = [
	TOOLBAR_COMMANDS.toggleStrong,
	TOOLBAR_COMMANDS.toggleEmphasis,
	TOOLBAR_COMMANDS.toggleStrikethrough,
	TOOLBAR_COMMANDS.toggleCode
] as const;

function router(over: Partial<CrossBlockCommandRouter> = {}): CrossBlockCommandRouter {
	return { canRun: () => true, run: () => true, isActive: () => true, ...over };
}

function context(over: Partial<CommandDispatchContext> = {}): CommandDispatchContext {
	return {
		history: { requestUndo: () => {}, requestRedo: () => {} },
		activation: everyInstalledPlugin,
		getPresentationMode: () => 'source',
		isCrossBlockRange: () => true,
		crossBlockCommands: undefined,
		...over
	};
}

const surface = (runCommand = vi.fn(() => true)): KindCommandTarget => ({
	kind: 'paragraph',
	runCommand,
	isCommandActive: () => true
});

describe('a range command with the branch wired', () => {
	const ctx = context({ crossBlockCommands: router() });

	it.each(TOGGLES)('%s is admissible, and the press spends the arm, not the surface', (id) => {
		const run = vi.fn(() => true);
		expect(canRunCommandById(id, surface(), ctx)).toBe(true);
		expect(runCommandById(id, undefined, surface(run), ctx)).toBe(true);
		expect(run).not.toHaveBeenCalled();
	});

	it('the link editor stays declined: it creates over one block, and no branch answers for it', () => {
		expect(canRunCommandById(TOOLBAR_COMMANDS.editLink, surface(), ctx)).toBe(false);
		expect(runCommandById(TOOLBAR_COMMANDS.editLink, undefined, surface(), ctx)).toBe(false);
	});

	it('a router that declines the id declines the press, rather than falling through', () => {
		const run = vi.fn(() => true);
		const declining = context({ crossBlockCommands: router({ canRun: () => false }) });
		expect(canRunCommandById(TOGGLES[0], surface(), declining)).toBe(false);
		expect(runCommandById(TOGGLES[0], undefined, surface(run), declining)).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it('a range-safe id still runs on the focused surface', () => {
		const run = vi.fn(() => true);
		expect(runCommandById('block.split', undefined, surface(run), ctx)).toBe(true);
		expect(run).toHaveBeenCalled();
	});
});

// The case that matters: a caller that passes no router hands `undefined`, and the rewrites must
// decline there rather than rewriting against the focused block.
describe('a range command with no branch threaded', () => {
	it.each(TOGGLES)('%s declines, and the focused surface is never asked', (id) => {
		const run = vi.fn(() => true);
		expect(canRunCommandById(id, surface(), context())).toBe(false);
		expect(runCommandById(id, undefined, surface(run), context())).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});
});

describe('the pressed-state read follows the same route', () => {
	it('the branch answers over a range, and the surface answers at a caret', () => {
		const armed = context({ crossBlockCommands: router({ isActive: () => false }) });
		expect(isCommandActiveById(TOGGLES[0], surface(), armed)).toBe(false);
		const collapsed = context({ isCrossBlockRange: () => false });
		expect(isCommandActiveById(TOGGLES[0], surface(), collapsed)).toBe(true);
	});

	it('a range no branch reads has no pressed state, whatever the resting caret sits inside', () => {
		expect(isCommandActiveById(TOGGLES[0], surface(), context())).toBe(false);
		expect(isCommandActiveById(TOOLBAR_COMMANDS.editLink, surface(), context())).toBe(false);
	});
});
