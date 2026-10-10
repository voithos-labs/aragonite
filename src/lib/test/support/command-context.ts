// The command context an editor builds, for suites that dispatch without mounting one: every
// plugin active, source mode, no range, no overrides. `over` replaces any member.
import type {
	CommandDispatchContext,
	CrossBlockCommandRouter
} from '#lib/schema/block-commands.js';
import type { KeybindingOverrideMap } from '#lib/schema/keybinding-overrides.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';

/** A cross-block handler that reaches nothing, as with no range painted. */
export const INERT_RANGE_ROUTER: CrossBlockCommandRouter = {
	canRun: () => false,
	run: () => false,
	isActive: () => false
};

export function commandContext(over: Partial<CommandDispatchContext> = {}): CommandDispatchContext {
	return {
		history: { requestUndo: () => {}, requestRedo: () => {} },
		pluginEditor: undefined,
		activation: everyInstalledPlugin,
		getPresentationMode: () => 'source',
		isCrossBlockRange: () => false,
		crossBlockCommands: INERT_RANGE_ROUTER,
		keybindingOverrides: () => undefined,
		onCommandError: () => {},
		reorder: { nudgeReorderUnit: async () => false },
		...over
	};
}

/** The same context with a consumer's compiled `keybindings`. */
export function commandContextWith(
	overrides: KeybindingOverrideMap | undefined,
	over: Partial<CommandDispatchContext> = {}
): CommandDispatchContext {
	return commandContext({ keybindingOverrides: () => overrides, ...over });
}
