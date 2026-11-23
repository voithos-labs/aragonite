// @vitest-environment node
// `check` drives what a plugin runs: a command or a pick that waits writes nothing once the host
// loads another note, and a block's command writes the block it is handed, not the caret's.
import { afterEach, describe, expect, it, vi } from 'vitest';
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

	// Miss: no fixture read the selection, so a command that leaves with none passed undriven.
	it('puts the caret in the note, so a command that acts at the caret is driven', async () => {
		const atCaret = commanding('at-caret', async (editor) => {
			const at = editor.selection?.head;
			if (at === undefined) return;
			await Promise.resolve();
			await editor.edit().replace({ from: at, to: at }, 'x').commit();
		});
		const row = rowOf(await reportOf(check(atCaret)), 'at-caret/go', 'waitingWrite');
		expect(row?.detail).toMatch(/a commit after the host loaded another note/);
	});

	// Miss: every late write was at byte 0, which any note holds; one past the next note's end was
	// refused for its range, and the row read that as nothing written.
	it('fails a late write at a byte the plugin kept, however long its sample', async () => {
		const shout = command<Block<never>>({
			id: 'shout',
			title: 'Shout',
			run: (async (editor: Editor, block: Block) => {
				const at = block.to - 1;
				await Promise.resolve();
				await editor.edit().replace({ from: at, to: at }, '!').commit();
			}) as never
		});
		const memo = lineBlock({
			name: 'memo',
			label: 'Memo',
			sample: '%%a memo a good deal longer than the note the host loads next',
			insert: { none: 'a fixture of the check suite' },
			match: /^%%(?<text>.*)$/,
			actions: [{ label: 'Shout', command: shout }]
		});
		const report = await reportOf(check(pluginOf('far', () => ({ blocks: [memo] }))));
		expect(rowOf(report, 'far/shout', 'waitingWrite')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/a commit after the host loaded another note/)
		});
	});

	// Miss: no fixture's `when` threw; the editor reports it and greys the command, and each row
	// read the greyed command as one that declines.
	it('fails each row whose `when` throws, on the row that asked it', async () => {
		const shout = command<Block<never>>({
			id: 'shout',
			title: 'Shout',
			when: () => {
				throw new Error('no answer for you');
			},
			run: () => true
		});
		const memo = lineBlock({
			name: 'memo',
			label: 'Memo',
			sample: '%%a memo',
			insert: { none: 'a fixture of the check suite' },
			match: /^%%(?<text>.*)$/,
			actions: [{ label: 'Shout', command: shout }]
		});
		const report = await reportOf(check(pluginOf('when-throws', () => ({ blocks: [memo] }))));
		for (const name of ['waitingWrite', 'actionTarget']) {
			expect(rowOf(report, 'when-throws/shout', name)).toMatchObject({
				status: 'failed',
				detail: expect.stringMatching(/the editor reported your plugin.*no answer for you/)
			});
		}
	});

	it('reads not-applicable for a command that answers with no promise', async () => {
		const now = commanding('now', () => true);
		expect(rowOf(await check(now), 'now/go', 'waitingWrite')).toMatchObject({
			status: 'not-applicable',
			detail: expect.stringMatching(/no wait/)
		});
	});

	// E24 reads a screen-bound command unchecked; with no promise there is no wait, screen or not.
	it('reads not-applicable for an unplaced command that only opens a menu', async () => {
		const list = menu<MenuRow>({ label: 'List', trigger: '%', rows: () => [], pick: () => {} });
		const opens = commanding('opens', (editor) => editor.openMenu(list));
		const report = await check(opens);
		expect(rowOf(report, 'opens/go', 'waitingWrite')?.status).toBe('not-applicable');
		expect(rowOf(report, 'opens/go', 'actionTarget')?.status).toBe('not-applicable');
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

	it('puts the caret after the trigger, where a pick that reads the selection finds it', async () => {
		const heads: unknown[] = [];
		const reads = pluginOf('reads-caret', () => ({
			menus: [
				menu<MenuRow & { editor: Editor }>({
					label: 'Mention',
					trigger: '@',
					rows: (_query, { editor }) => [{ label: 'Ada', editor }],
					async pick(row) {
						heads.push(row.editor.selection?.head);
						await Promise.resolve();
					}
				})
			]
		}));
		await check(reads);
		expect(heads).toEqual([1]);
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

// Miss: every waiting fixture settled, so a wait that never ends hung `check` and no row said so.
describe('a wait that outlasts the bound', () => {
	afterEach(() => void vi.useRealTimers());

	const never = () => new Promise<never>(() => {});
	/** A promise the test settles by hand. */
	function held() {
		let release!: () => void;
		const wait = new Promise<void>((resolve) => (release = resolve));
		return { wait, release };
	}

	it('fails a command whose wait never ends, with a detail naming the bound', async () => {
		const stuck = commanding('stuck', never);
		const row = rowOf(await reportOf(check(stuck, { timeout: 30 })), 'stuck/go', 'waitingWrite');
		expect(row).toMatchObject({ of: 'command', status: 'failed' });
		expect(row?.detail).toMatch(/^it did not settle within 30 ms.*`timeout`/);
	});

	it('waits two seconds unless told, under a test runner’s own five', async () => {
		vi.useFakeTimers();
		let ended = false;
		const run = reportOf(check(commanding('stuck-default', never))).finally(() => (ended = true));
		await vi.advanceTimersByTimeAsync(1999);
		expect(ended).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(rowOf(await run, 'stuck-default/go', 'waitingWrite')?.status).toBe('failed');
	});

	it('refuses a bound that is no positive number of milliseconds', async () => {
		const fine = commanding('fine', () => true);
		await expect(check(fine, { timeout: 0 })).rejects.toThrow(/timeout/);
		await expect(check(fine, { timeout: '5s' as never })).rejects.toThrow(/timeout/);
	});

	it('fails a menu whose rows never come', async () => {
		const stuck = pluginOf('stuck-rows', () => ({
			menus: [menu<MenuRow>({ label: 'Stuck', trigger: '@', rows: never, pick: () => {} })]
		}));
		const row = rowOf(await reportOf(check(stuck, { timeout: 30 })), '@', 'waitingWrite');
		expect(row).toMatchObject({ of: 'menu', status: 'failed' });
		expect(row?.detail).toMatch(/its rows for an empty query did not settle within 30 ms/);
	});

	it('fails a pick that never settles, and drives the menu after it alone', async () => {
		const picking = (trigger: string, pick: () => unknown) =>
			menu<MenuRow>({
				label: trigger,
				trigger,
				rows: () => [{ label: 'Ada' }],
				pick: pick as never
			});
		const both = pluginOf('stuck-pick', () => ({
			menus: [picking('@', never), picking('%', async () => void (await Promise.resolve()))]
		}));
		const report = await reportOf(check(both, { timeout: 30 }));
		expect(rowOf(report, '@', 'waitingWrite')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/^its pick of "Ada" did not settle within 30 ms/)
		});
		expect(rowOf(report, '%', 'waitingWrite')?.status).toBe('passed');
	});

	it('leaves a call that settles past the bound behind: the next row reads as it does alone', async () => {
		vi.useFakeTimers();
		const [first, second] = [held(), held()];
		const slow = command({ id: 'slow', title: 'Slow', run: (() => first.wait) as never });
		const early = command({
			id: 'early',
			title: 'Early',
			run: (async (editor: Editor) => {
				const draft = editor.edit().replace({ from: 0, to: 0 }, 'x');
				await second.wait;
				await draft.commit();
			}) as never
		});
		const plugin = pluginOf('slow-then-early', () => ({ commands: [slow, early] }));
		const run = reportOf(check(plugin, { timeout: 30 }));
		await vi.advanceTimersByTimeAsync(30);
		// `slow` settles while `early` is waiting, as a call just past its bound would.
		first.release();
		await vi.advanceTimersByTimeAsync(0);
		second.release();
		const report = await run;
		expect(rowOf(report, 'slow-then-early/slow', 'waitingWrite')?.status).toBe('failed');
		expect(rowOf(report, 'slow-then-early/early', 'waitingWrite')).toMatchObject({
			status: 'passed',
			detail: 'it waited, and wrote nothing into the next note'
		});
	});
});
