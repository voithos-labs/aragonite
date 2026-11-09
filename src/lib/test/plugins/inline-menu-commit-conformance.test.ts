import { describe, it, expect } from 'vitest';
import { checkMenuPickAcrossSwap } from '#lib/testing.js';
import { definePlugin, menu, type Editor, type MenuRow } from '#lib/plugin.js';
import { slashCommands } from '#packages/slash-commands/src/index.js';

// The kit cell must pass a menu whose waiting pick writes through the pick, and fail one that
// writes through an editor it kept from `setup`.
function held() {
	let release = () => {};
	const wait = new Promise<void>((r) => (release = r));
	return { wait, release: () => release() };
}

/** A `@` menu whose pick waits, then writes through `write`, which gets the pick and the editor
 *  `setup` handed the plugin. */
function waitingMenu(
	gate: Promise<void>,
	write: (pick: { write(s: string): unknown }, editor: Editor) => unknown
) {
	let kept: Editor;
	return definePlugin({
		name: 'waiting',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			setup: (editor) => void (kept = editor),
			menus: [
				menu<MenuRow>({
					label: 'Mention',
					trigger: '@',
					rows: () => [],
					async pick(_row, pick) {
						await gate;
						await write(pick, kept);
					}
				})
			]
		})
	});
}

describe('checkMenuPickAcrossSwap', () => {
	it('passes the slash menu with a host run that waits, then inserts through the pick', async () => {
		const gate = held();
		const entries = [
			{
				id: 'e',
				label: 'E',
				run: async (pick: { insertBlock(md: string): Promise<unknown> }) => {
					await gate.wait;
					await pick.insertBlock('> embed');
				}
			}
		];
		const row = {
			entry: { id: 'e', action: { kind: 'run', run: entries[0].run } },
			argument: null
		};
		await checkMenuPickAcrossSwap({
			plugin: slashCommands({ entries }),
			row,
			query: 'e',
			release: gate.release
		});
	});

	it('passes a menu whose waiting pick writes through the pick', async () => {
		const gate = held();
		await checkMenuPickAcrossSwap({
			plugin: waitingMenu(gate.wait, (pick) => pick.write('@Ada')),
			row: { label: 'Ada' },
			release: gate.release
		});
	});

	it('fails a menu whose waiting pick writes through the editor it kept from setup', async () => {
		const gate = held();
		await expect(
			checkMenuPickAcrossSwap({
				plugin: waitingMenu(gate.wait, (_pick, editor) =>
					editor.edit().replace({ from: 0, to: 0 }, '@').commit()
				),
				row: { label: 'Ada' },
				release: gate.release
			})
		).rejects.toThrow(/after the host loaded another document/);
	});
});
