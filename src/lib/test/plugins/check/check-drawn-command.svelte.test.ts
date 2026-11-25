// @vitest-environment jsdom
// Miss-analysis: `check` ran a block type's commands with no handle at all, so a component handing
// one shape to a command reading another passed every row and threw only in a mounted editor.
// `drawnCommand`: each command a block type places runs on a drawn sample block, handed what the
// drawing declares; a throw or a rejection fails it.
import { describe, expect, it } from 'vitest';
import {
	command,
	definePlugin,
	fencedBlock,
	lineBlock,
	type Block,
	type BoxDrawContext,
	type Drawn
} from '#lib/plugin.js';
import { svelteBlock } from '#lib/components/drawn-block/svelte-block.svelte.js';
import { check, isCheckFailure, type CheckReport, type Excuses } from '#lib/testing/check.js';
import ShutHandle from '#lib/test/plugins/fixtures/ShutHandle.svelte';

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	try {
		return await run;
	} catch (error) {
		if (isCheckFailure(error)) return error.report;
		throw error;
	}
}

const rowOf = (report: CheckReport, subject: string) =>
	report.rows.find((row) => row.subject === subject && row.check === 'drawnCommand');

interface Opens {
	open(): unknown;
}

type Draw = (block: Block<never>, ctx: BoxDrawContext) => Drawn<never, BoxDrawContext, Opens>;

/** A box type drawn by `draw`, its command `open` listed in `commands` or as a menu row. */
function boxes(name: string, draw: Draw, place: 'commands' | 'actions' = 'commands') {
	const open = command<Block<never>, Opens>({
		id: 'open',
		title: 'Open',
		// No handle while the block isn't drawn, as the other rows run it.
		run: (_editor, _block, ui) => (ui ? (ui.open() as never) : false)
	});
	const box = fencedBlock({
		name: 'box',
		label: 'Box',
		fence: { info: 'box' },
		sample: '```box\nx\n```',
		insert: { none: 'a fixture of the check suite' },
		edit: 'box',
		draw,
		...(place === 'commands'
			? { commands: [open] }
			: { actions: [{ label: 'Open', command: open }] })
	});
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [box] })
	});
}

const handing =
	(open: () => unknown): Draw =>
	() => ({
		dom: document.createElement('div'),
		handle: { open }
	});

describe('drawnCommand', () => {
	it.each(['commands', 'actions'] as const)(
		'fails a command listed in %s that reads what its component never hands',
		async (place) => {
			const shut = boxes(`shut-${place}`, svelteBlock(ShutHandle), place);
			expect(rowOf(await reportOf(check(shut)), `shut-${place}/open`)).toMatchObject({
				of: 'command',
				status: 'failed',
				detail: expect.stringMatching(/^threw, handed what its drawing declares: .*open/)
			});
		}
	);

	it('passes a command its drawing hands what it reads, having run it once', async () => {
		let opened = 0;
		const report = await check(
			boxes(
				'opens',
				handing(() => opened++)
			)
		);
		expect(rowOf(report, 'opens/open')?.status).toBe('passed');
		expect(opened).toBe(1);
	});

	it('fails a command whose promise rejects', async () => {
		const rejects = boxes(
			'rejects',
			handing(() => Promise.reject(new Error('no server')))
		);
		expect(rowOf(await reportOf(check(rejects)), 'rejects/open')).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/rejected.*no server/)
		});
	});

	it('reads not-applicable where no drawing hands anything', async () => {
		const loose = command({ id: 'loose', title: 'Loose', run: () => true });
		const plain = command<Block<never>>({ id: 'plain', title: 'Plain', run: () => true });
		const memo = lineBlock({
			name: 'memo',
			label: 'Memo',
			sample: '%%a memo',
			insert: { none: 'a fixture of the check suite' },
			match: /^%%(?<text>.*)$/,
			commands: [plain]
		});
		const plugin = definePlugin({
			name: 'undrawn',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [memo], commands: [loose] })
		});
		const report = await check(plugin);
		expect(rowOf(report, 'undrawn/loose')?.status).toBe('not-applicable');
		expect(rowOf(report, 'undrawn/plain')?.status).toBe('not-applicable');
	});

	it('takes no excuse', () => {
		// @ts-expect-error: a throw is never a reason.
		const excuse: Excuses = { commands: { open: { drawnCommand: 'It throws on purpose.' } } };
		void excuse;
	});
});
