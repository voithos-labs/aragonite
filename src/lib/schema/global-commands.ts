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
	warnDeadKeyCommand
} from './commands';
import { currentInstallingPlugin } from './plugin-install';
import type { EditorContext } from './plugin-install';

export function registerGlobalCommand(
	name: string,
	handler: (editor: EditorContext, arg?: unknown) => boolean,
	opts?: { chord?: string }
): PluginCommandId {
	// Validate the chord before creating the id: a collision must not leave a created name and a
	// registered handler behind a failed registration.
	if (opts?.chord) assertPluginGlobalChordAvailable(opts.chord, name);
	const owner = currentInstallingPlugin();
	const id = mintCommandId(name);
	registerCommand(id, (ctx) => {
		if (!ctx.pluginEditor) {
			warnDeadKeyCommand(id, 'plugin-global');
			return false;
		}
		// Installed process-wide but absent from this editor's `plugins` prop: inert here, not dead,
		// so it must not use up the dead-key warning a truly unreachable id gets.
		const editor = ctx.pluginEditor(owner ?? '');
		if (!editor) return false;
		try {
			return handler(editor, ctx.arg);
		} catch (error) {
			ctx.onCommandError?.({ command: id, plugin: owner ?? undefined, error });
			return true;
		}
	});
	if (opts?.chord) registerPluginGlobalBinding({ chord: opts.chord, command: id });
	return id;
}
