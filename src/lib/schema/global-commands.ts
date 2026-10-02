/**
 * Plugin-facing global commands: create a process-wide command id, register a handler that
 * receives the dispatching editor's `EditorContext` and the dispatch's argument, and optionally
 * bind a chord among the plugin-global chords (last in precedence). Beside `block-commands`, not
 * in `commands.ts`, so `commands → command-id` stays one-directional.
 */
import { mintCommandId, type PluginCommandId } from './command-id';
import {
	registerCommand,
	registerPluginGlobalBinding,
	assertPluginGlobalChordAvailable,
	globalCommandOwner,
	runPluginCommand,
	warnDeadKeyCommand
} from './commands';
import { pluginEditorFor, type EditorContext } from './plugin-install';

export function registerGlobalCommand(
	name: string,
	handler: (editor: EditorContext, arg?: unknown) => boolean,
	opts?: { chord?: string }
): PluginCommandId {
	// Validate the chord before creating the id: a collision must not leave a created name and a
	// registered handler behind a failed registration.
	if (opts?.chord) assertPluginGlobalChordAvailable(opts.chord, name);
	const id = mintCommandId(name);
	registerCommand(id, (ctx) => {
		if (!ctx.pluginEditor) {
			warnDeadKeyCommand(id, 'plugin-global');
			return false;
		}
		const owner = globalCommandOwner(id);
		// A global handler takes a context it can't run without, so a missing one declines, and
		// that is inert rather than dead; a block handler runs with `ctx.editor` undefined instead.
		const editor = pluginEditorFor(ctx.pluginEditor, owner);
		if (!editor) return false;
		return runPluginCommand(owner, { command: id }, ctx.onCommandError, () =>
			handler(editor, ctx.arg)
		);
	});
	if (opts?.chord) registerPluginGlobalBinding({ chord: opts.chord, command: id });
	return id;
}
