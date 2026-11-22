// @vitest-environment jsdom
// What a block type's menu rows show: a label read off the block the menu opened over, or the
// command's title where that label fails.
// Miss-analysis: every row's label was a fixed string, so no row read a label against its block.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { command, definePlugin, type Block, type BlockAction } from '#lib/plugin.js';
import { container } from '#lib/components/block-makers/container.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

interface AlertData {
	type: string;
}

const TYPES = ['NOTE', 'TIP', 'WARNING'];
const next = (type: string) => TYPES[(TYPES.indexOf(type) + 1) % TYPES.length];

/** An alerts plugin whose type lists `actions`, each over the one command `cycle`. */
function alertsWith(
	actions: (cycle: BlockAction<AlertData>['command']) => BlockAction<AlertData>[]
) {
	const cycle = command<Block<AlertData>>({ id: 'cycle', title: 'Next kind', run: () => {} });
	const alert = container<AlertData>({
		name: 'alert',
		label: 'Alert',
		sample: '%> [!NOTE]\n%> x',
		insert: { none: 'a test block type' },
		lines: {
			shape: 'marked',
			first: '%> ',
			rest: '%> ',
			reads: /^%> ?/,
			lazy: true,
			head: {
				match: /^\[!(\w+)\]$/,
				data: (m: RegExpExecArray) => ({ type: m[1] }),
				write: (data: AlertData) => `[!${data.type}]`
			}
		},
		actions: actions(cycle)
	});
	return definePlugin({
		name: 'alerts',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [alert] })
	});
}

const TWO = 'intro\n\n%> [!NOTE]\n%> one\n\n%> [!TIP]\n%> two\n';

async function mounted(plugin: ReturnType<typeof alertsWith>) {
	const errors: PluginError[] = [];
	const editor = mountEditor({ source: TWO, plugins: [plugin], onError: (e) => errors.push(e) });
	await editor.settle();
	return { editor, errors };
}

/** The flyout rows a right-click in the paragraph at `path` shows, opened from the type's entry. */
async function flyoutRows(editor: MountedEditor, path: number[]): Promise<string[]> {
	const surface = surfaceAt(editor, path);
	surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
	await editor.settle();
	[...document.querySelectorAll<HTMLElement>('.block-menu .md-menu-item')]
		.find((el) => el.textContent?.trim() === 'Alert')!
		.dispatchEvent(new Event('pointerenter'));
	await editor.settle();
	const rows = document.querySelectorAll('.block-menu-flyout .md-menu-item .block-menu-label');
	return [...rows].map((row) => row.textContent ?? '');
}

describe("a block type's menu row", () => {
	it('reads its label off the block the menu opened over, for two blocks of one type', async () => {
		const plugin = alertsWith((cycle) => [
			{ label: (block) => `Make it ${next(block.data.type).toLowerCase()}`, command: cycle }
		]);
		const { editor, errors } = await mounted(plugin);
		expect(await flyoutRows(editor, [1, 0])).toEqual(['Make it tip']);
		expect(await flyoutRows(editor, [2, 0])).toEqual(['Make it warning']);
		expect(errors).toEqual([]);
	});

	it.each([
		[
			'throws',
			() => {
				throw new Error('no label');
			},
			'no label'
		],
		['answers something not text', () => 42 as unknown as string, 'a number, not text']
	])('shows the command title where its label %s, and is reported once', async (_, label, said) => {
		const plugin = alertsWith((cycle) => [
			{ label, command: cycle },
			{ label: 'Still here', command: cycle }
		]);
		const { editor, errors } = await mounted(plugin);
		expect(await flyoutRows(editor, [1, 0])).toEqual(['Next kind', 'Still here']);
		expect(errors.map(({ plugin, doing }) => ({ plugin, doing }))).toEqual([
			{ plugin: 'alerts', doing: 'label for alerts/cycle' }
		]);
		expect((errors[0].cause as Error).message).toContain(said);
	});
});
