/**
 * Plugin-facing global commands: mint a process-wide command id, register a handler receiving
 * the dispatching instance's EditorContext, optionally bind a chord in the plugin-global tier
 * (last in precedence). Beside block-commands, not in commands.ts, for the same cycle reason —
 * commands ← command-id must stay one-directional.
 */
import { mintCommandId, type PluginCommandId } from './command-id';
import {
	registerCommand,
	registerPluginGlobalBinding,
	assertPluginGlobalChordAvailable,
	warnUnresolvedPluginCommand
} from './commands';
import { currentInstallingPlugin } from './plugin-install';
import type { EditorContext } from './plugin-install';

const owners = new Map<string, string | null>();

export function registerGlobalCommand(
	name: string,
	handler: (editor: EditorContext) => boolean,
	opts?: { chord?: string }
): PluginCommandId {
	// Validate the chord BEFORE the mint: a collision must not leave a minted name and a
	// registered handler behind a failed registration.
	if (opts?.chord) assertPluginGlobalChordAvailable(opts.chord, name);
	const owner = currentInstallingPlugin();
	// Owner-attributed: it is what lets a plugin re-mint its own name, and what names the prior
	// owner in a cross-plugin collision.
	const id = mintCommandId(name, owner);
	owners.set(id, owner);
	registerCommand(id, (ctx) => {
		const editor = ctx.pluginEditor?.(owner ?? '');
		if (!editor) {
			warnUnresolvedPluginCommand(id);
			return false;
		}
		try {
			return handler(editor);
		} catch (error) {
			ctx.onCommandError?.({ command: id, plugin: owner ?? undefined, error });
			return true;
		}
	});
	if (opts?.chord) registerPluginGlobalBinding({ chord: opts.chord, command: id });
	return id;
}

export function __resetPluginGlobalCommandsForTests(): void {
	owners.clear();
}
