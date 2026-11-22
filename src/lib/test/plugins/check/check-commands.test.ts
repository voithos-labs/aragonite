// @vitest-environment node
// `check` drives what a plugin runs: a command or a pick that waits writes nothing once the host
// loads another note, and a block's command writes the block it is handed, not the caret's.
import { describe, expect, it } from 'vitest';
import {
	command,
	definePlugin,
	lineBlock,
	mark,
	menu,
	type Block,
	type Editor,
	type MenuRow,
	type Plugin
} from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport, type Excuses } from '#lib/testing/check.js';
import { slashCommands } from '#packages/slash-commands/src/index.js';

function pluginOf(name: string, contributes: () => object): Plugin {
	return definePlugin({ name, version: '1.0.0', editor: '*', contributes });
}

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	try {
		return await run;
	} catch (error) {
		if (isCheckFailure(error)) return error.report;
		throw error;
	}
}

const rowOf = (report: CheckReport, subject: string, check: string) =>
	report.rows.find((row) => row.subject === subject && row.check === check);

/** A plugin listing one command that runs `run`. */
const commanding = (name: string, run: (editor: Editor) => unknown) =>
	pluginOf(name, () => ({ commands: [command({ id: 'go', title: 'Go', run: run as never })] }));

/** An `@` menu whose pick waits a turn, then writes through `write`. */
function waitingMenu(
	name: string,
	write: (pick: { write(s: string): unknown }, editor: Editor) => unknown
) {
	let seen: Editor;
	return pluginOf(name, () => ({
		menus: [
			menu<MenuRow>({
				label: 'Mention',
				trigger: '@',
				rows: (_query, { editor }) => ((seen = editor), [{ label: 'Ada' }]),
				async pick(_row, pick) {
					await Promise.resolve();
					await write(pick, seen);
				}
			})
		]
	}));
}

describe('waitingWrite over commands', () => {
	it('fails a command that waits, then writes through a draft it opens after the wait', async () => {
		const late = commanding('late', async (editor) => {
			await Promise.resolve();
			await editor.edit().replace({ from: 0, to: 0 }, 'x').commit();
		});
		const row = rowOf(await reportOf(check(late)), 'late/go', 'waitingWrite');
		expect(row).toMatchObject({ of: 'command', status: 'failed' });
		expect(row?.detail).toMatch(/a commit after the host loaded another note/);
	});

	it('passes a command whose draft was opened before its wait', async () => {
		const early = commanding('early', async (editor) => {
			const draft = editor.edit().replace({ from: 0, to: 0 }, 'x');
			await Promise.resolve();
			await draft.commit();
		});
		expect(rowOf(await check(early), 'early/go', 'waitingWrite')?.status).toBe('passed');
	});

	it('passes a command that writes through the editor before it waits', async () => {
		const first = commanding('first', async (editor) => {
			await editor.edit().replace({ from: 0, to: 0 }, 'x').commit();
			await Promise.resolve();
		});
		expect(rowOf(await check(first), 'first/go', 'waitingWrite')?.status).toBe('passed');
	});

	it('reads not-applicable for a command that answers with no promise', async () => {
		const now = commanding('now', () => true);
		expect(rowOf(await check(now), 'now/go', 'waitingWrite')).toMatchObject({
			status: 'not-applicable',
			detail: expect.stringMatching(/no wait/)
		});
	});

	it('takes an excuse by the command’s own id', async () => {
		const late = commanding('late-ok', async (editor) => {
			await Promise.resolve();
			await editor.edit().replace({ from: 0, to: 0 }, 'x').commit();
		});
		const excuse: Excuses = {
			commands: { go: { waitingWrite: 'The write is a log line the next note wants.' } }
		};
		expect(rowOf(await check(late, { excuse }), 'late-ok/go', 'waitingWrite')?.status).toBe(
			'excused'
		);
	});

	it('leaves a mark’s toggle out of the command rows', async () => {
		const hl = mark({
			name: 'hl',
			label: 'Highlight',
			marker: '==',
			chord: 'Mod+Shift+H',
			sample: 'a ==b== c'
		});
		const report = await check(pluginOf('marks', () => ({ inlines: [hl] })));
		expect(rowOf(report, 'marks/hl', 'claims')?.status).toBe('passed');
		expect(report.rows.filter((row) => row.of === 'command')).toEqual([]);
	});

	it('reads unchecked with no DOM where the plugin lists a setup that runs first', async () => {
		const set = pluginOf('set', () => ({
			setup: () => {},
			commands: [command({ id: 'go', title: 'Go', run: async () => {} })]
		}));
		expect(rowOf(await check(set), 'set/go', 'waitingWrite')).toMatchObject({
			status: 'unchecked',
			detail: expect.stringMatching(/needs a DOM/)
		});
	});
});

describe('waitingWrite over menus', () => {
	it('picks the slash menu’s first row, a heading, whose built-in command is heard', async () => {
		const report = await check(slashCommands);
		expect(rowOf(report, '/', 'waitingWrite')).toMatchObject({
			of: 'menu',
			status: 'passed',
			detail: expect.stringMatching(/"Heading 1"/)
		});
		expect(rowOf(report, 'slash-commands/open', 'waitingWrite')?.status).toBe('not-applicable');
		expect(rowOf(report, 'slash-commands/open', 'actionTarget')?.status).toBe('not-applicable');
	});

	it('passes a slash host row that waits, then inserts through the pick', async () => {
		const run = async (pick: { insertBlock(md: string): Promise<unknown> }) => {
			await Promise.resolve();
			await pick.insertBlock('> embed');
		};
		const slash = slashCommands({
			exclude: ['h1', 'h2', 'h3'],
			entries: [{ id: 'e', label: 'E', run }]
		});
		expect(rowOf(await check(slash), '/', 'waitingWrite')?.status).toBe('passed');
	});

	it('passes a menu whose waiting pick writes through the pick', async () => {
		const good = waitingMenu('good', (pick) => pick.write('@Ada'));
		expect(rowOf(await check(good), '@', 'waitingWrite')?.status).toBe('passed');
	});

	it('fails a menu whose waiting pick writes through an editor it kept', async () => {
		const kept = waitingMenu('kept', (_pick, editor) =>
			editor.edit().replace({ from: 0, to: 0 }, '@').commit()
		);
		const row = rowOf(await reportOf(check(kept)), '@', 'waitingWrite');
		expect(row?.status).toBe('failed');
		expect(row?.detail).toMatch(/its pick of "Ada" made a commit after the host loaded/);
	});

	it('folds menus sharing a trigger into one row, naming the one that failed', async () => {
		const both = pluginOf('two', () => ({
			menus: [
				menu<MenuRow>({
					label: 'Plain',
					trigger: '@',
					rows: () => [{ label: 'Bo' }],
					pick: () => {}
				}),
				menu<MenuRow>({
					label: 'Late',
					trigger: '@',
					rows: (_q, { editor }) => [{ label: 'Cy', editor } as MenuRow],
					async pick(row) {
						await Promise.resolve();
						await (row as MenuRow & { editor: Editor }).editor
							.edit()
							.replace({ from: 0, to: 0 }, '@')
							.commit();
					}
				})
			]
		}));
		const report = await reportOf(check(both));
		const rows = report.rows.filter((row) => row.of === 'menu');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'failed', detail: expect.stringMatching(/^Late: /) });
	});

	it('takes an excuse by trigger', async () => {
		const kept = waitingMenu('kept-ok', (_pick, editor) =>
			editor.edit().replace({ from: 0, to: 0 }, '@').commit()
		);
		const excuse: Excuses = {
			menus: { '@': { waitingWrite: 'The mention log follows the user.' } }
		};
		expect(rowOf(await check(kept, { excuse }), '@', 'waitingWrite')?.status).toBe('excused');
		// @ts-expect-error: a menu takes no actionTarget.
		const wrong: Excuses = { menus: { '@': { actionTarget: 'A menu runs on no block.' } } };
		void wrong;
	});
});

describe('actionTarget', () => {
	/** A memo type whose one block action is `run`. */
	function acting(name: string, run: (editor: Editor, block: Block) => unknown) {
		const shout = command<Block<never>>({ id: 'shout', title: 'Shout', run: run as never });
		const memo = lineBlock({
			name: 'memo',
			label: 'Memo',
			sample: '%%a memo',
			insert: { none: 'a fixture of the check suite' },
			match: /^%%(?<text>.*)$/,
			actions: [{ label: 'Shout', command: shout }]
		});
		return pluginOf(name, () => ({ blocks: [memo] }));
	}

	const shoutAt = (editor: Editor, block: Block | null | undefined) =>
		block &&
		editor
			.edit()
			.replace({ from: block.to - 1, to: block.to - 1 }, '!')
			.commit();

	it('fails a block action that writes the caret’s block, not the one it is handed', async () => {
		const caret = acting('caret', (editor) => shoutAt(editor, editor.selection?.block));
		const row = rowOf(await reportOf(check(caret)), 'caret/shout', 'actionTarget');
		expect(row).toMatchObject({ of: 'command', status: 'failed' });
		expect(row?.detail).toMatch(/handed the second block, it wrote the first block/);
	});

	it('passes a block action that writes its argument', async () => {
		const own = acting('own', (editor, block) => shoutAt(editor, block));
		expect(rowOf(await check(own), 'own/shout', 'actionTarget')?.status).toBe('passed');
	});

	it('fails a block action that inserts at the caret', async () => {
		const inserts = acting('inserts', (editor) => editor.edit().insert('more').commit());
		const row = rowOf(await reportOf(check(inserts)), 'inserts/shout', 'actionTarget');
		expect(row?.detail).toMatch(/made an insert of "more" at the caret/);
	});

	it('reads unchecked for an action that only asks the screen, and not-applicable for one that writes nothing', async () => {
		const screen = acting('screen', (editor, block) => (editor.view.boxOf(block), false));
		expect(rowOf(await check(screen), 'screen/shout', 'actionTarget')).toMatchObject({
			status: 'unchecked',
			detail: expect.stringMatching(/needs a browser: it asked view\.boxOf/)
		});
		const idle = acting('idle', () => false);
		expect(rowOf(await check(idle), 'idle/shout', 'actionTarget')?.status).toBe('not-applicable');
	});
});
