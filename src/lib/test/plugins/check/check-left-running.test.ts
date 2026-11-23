// @vitest-environment node
// Miss: every fixture's late work hung off the promise it returned, so a call that returned none, or
// left a command running, wrote or was reported after its row, and failed the next row instead.
import { describe, expect, it, vi } from 'vitest';
import {
	command,
	definePlugin,
	lineBlock,
	menu,
	type Block,
	type Editor,
	type MenuRow,
	type Plugin
} from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

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

/** Longer than the steps a row takes once a call is done, though inside one macrotask. */
async function later(): Promise<void> {
	for (let i = 0; i < 50; i++) await null;
}

/** Writes `text` at byte `at` once `later` has passed, with nothing returned to wait on. */
function writeLater(editor: Editor, at: number, text: string): void {
	void later().then(() => editor.edit().replace({ from: at, to: at }, text).commit());
}

describe('a call that returns no promise', () => {
	it('fails a command that writes once it has returned', async () => {
		const fire = pluginOf('fire', () => ({
			commands: [command({ id: 'go', title: 'Go', run: (editor) => writeLater(editor, 0, 'x') })]
		}));
		expect(rowOf(await reportOf(check(fire)), 'fire/go', 'waitingWrite')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(
				/^it made a commit after it returned, once the host loaded another note/
			)
		});
	});

	it('fails a pick that writes through an editor it kept once it has returned', async () => {
		const kept = pluginOf('kept-pick', () => ({
			menus: [
				menu<MenuRow & { editor: Editor }>({
					label: 'Mention',
					trigger: '@',
					rows: (_query, { editor }) => [{ label: 'Ada', editor }],
					pick: (row) => writeLater(row.editor, 0, '@')
				})
			]
		}));
		expect(rowOf(await reportOf(check(kept)), '@', 'waitingWrite')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/^its pick of "Ada" made a commit after it returned/)
		});
	});

	it('reads a block action’s late write on its own row, leaving the next command alone', async () => {
		const shout = command<Block<never>>({
			id: 'shout',
			title: 'Shout',
			run: ((editor: Editor) => {
				const block = editor.selection?.block;
				if (block) writeLater(editor, block.to - 1, '!');
			}) as never
		});
		const memo = lineBlock({
			name: 'memo',
			label: 'Memo',
			sample: '%%a memo',
			insert: { none: 'a fixture of the check suite' },
			match: /^%%(?<text>.*)$/,
			actions: [{ label: 'Shout', command: shout }]
		});
		const after = command({ id: 'after', title: 'After', run: async () => {} });
		const plugin = pluginOf('fire-action', () => ({ blocks: [memo], commands: [after] }));
		const report = await reportOf(check(plugin));
		expect(rowOf(report, 'fire-action/shout', 'actionTarget')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/handed the second block, it wrote the first block/)
		});
		expect(rowOf(report, 'fire-action/after', 'waitingWrite')?.status).toBe('passed');
	});

	// The turn runs on the timer as loaded, so a suite's fake timers can't hold `check` there.
	it('ends under fake timers nobody advances', async () => {
		vi.useFakeTimers();
		try {
			const now = pluginOf('now', () => ({
				commands: [command({ id: 'go', title: 'Go', run: () => true })]
			}));
			expect(rowOf(await check(now), 'now/go', 'waitingWrite')).toMatchObject({
				status: 'not-applicable',
				detail: 'it answers at once, with no wait to outlive a note'
			});
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('a report that arrives once the call is done', () => {
	it('fails the pick that started the command it was heard for, whether it waited or not', async () => {
		const fetch = command({
			id: 'fetch',
			title: 'Fetch',
			run: (async () => {
				await later();
				throw new Error('server down');
			}) as never
		});
		const plugin = pluginOf('starts', () => ({
			commands: [fetch],
			menus: [
				menu<MenuRow>({
					label: 'Waits',
					trigger: '@',
					rows: () => [{ label: 'Ada' }],
					pick: async (_row, pick) => void (await pick.run(fetch))
				}),
				menu<MenuRow>({
					label: 'Returns',
					trigger: '%',
					rows: () => [{ label: 'Bo' }],
					pick: (_row, pick) => void pick.run(fetch)
				}),
				menu<MenuRow>({
					label: 'Quiet',
					trigger: '#',
					rows: () => [{ label: 'Cy' }],
					pick: async () => {}
				})
			]
		}));
		const report = await reportOf(check(plugin));
		for (const trigger of ['@', '%']) {
			expect(rowOf(report, trigger, 'waitingWrite'), trigger).toMatchObject({
				status: 'failed',
				detail: 'the editor reported your plugin (run starts/fetch: server down)'
			});
		}
		expect(rowOf(report, '#', 'waitingWrite')?.status).toBe('passed');
	});
});
