// @vitest-environment jsdom
// A block type's keys and menu rows place commands that run on its block: by id or value from the
// caret, by the type's key from a block inside it, and by a host's rebinding of that key.
// Miss-analysis: block commands ran only through the process-wide `registerBlockCommand` registry,
// and no row ran a plugin block command by id from a value plugin (N17).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { command, definePlugin, type Command } from '#lib/plugin.js';
import { container } from '#lib/components/block-makers/container.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { BlockCommon } from '#lib/schema/block-shapes.js';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

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

/** A fresh alerts plugin each call, so its block type and commands carry no earlier install. */
function makeAlerts(
	more: (cycle: Command<Block<AlertData>>) => Partial<BlockCommon<AlertData>> = () => ({}),
	when?: () => boolean
) {
	const ran: Block<AlertData>[] = [];
	const cycle = command<Block<AlertData>>({
		id: 'cycle',
		title: 'Next kind',
		when: when && (() => when()),
		run(editor, block) {
			ran.push(block);
			void editor
				.edit()
				.data(block, { type: next(block.data.type) })
				.commit();
		}
	});
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
		chords: { 'Mod+7': cycle },
		actions: [{ label: 'Next kind', command: cycle }],
		...more(cycle)
	});
	const plugin = definePlugin({
		name: 'alerts',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [alert] })
	});
	return { plugin, alert, cycle, ran };
}

const DOC = 'intro\n\n%> [!NOTE]\n%> inside\n';
const CTRL_7 = { key: '7', ctrlKey: true };

async function mounted(source: string, alerts = makeAlerts(), keybindings?: KeybindingOverride[]) {
	const errors: PluginError[] = [];
	const editor = mountEditor({
		source,
		plugins: [alerts.plugin],
		keybindings,
		onError: (error: PluginError) => errors.push(error)
	});
	await editor.settle();
	return { editor, errors, ...alerts };
}

describe('a placed command run from the caret', () => {
	it('runs by id, by value and through runCommand on the alert holding the caret', async () => {
		const { editor, cycle } = await mounted(DOC);
		placeCaret(surfaceAt(editor, [1, 0]), 2);
		expect(editor.instance.run('alerts/cycle')).toBe(true);
		await editor.settle();
		expect(editor.source()).toBe('intro\n\n%> [!TIP]\n%> inside\n');
		expect(editor.instance.run(cycle)).toBe(true);
		await editor.settle();
		expect(editor.instance.runCommand('alerts/cycle')).toBe(true);
		await editor.settle();
		expect(editor.source()).toBe('intro\n\n%> [!NOTE]\n%> inside\n');
	});

	it('declines with no alert around the caret, writing nothing', async () => {
		const { editor, cycle, ran } = await mounted(DOC);
		placeCaret(surfaceAt(editor, [0]), 2);
		expect(editor.instance.can(cycle)).toBe(false);
		expect(editor.instance.run(cycle)).toBe(false);
		await editor.settle();
		expect(ran).toEqual([]);
		expect(editor.source()).toBe(DOC);
	});

	it('greys and refuses where `when` says no', async () => {
		let allowed = false;
		const { editor, cycle } = await mounted(
			DOC,
			makeAlerts(undefined, () => allowed)
		);
		placeCaret(surfaceAt(editor, [1, 0]), 2);
		expect(editor.instance.can(cycle)).toBe(false);
		expect(editor.instance.run(cycle)).toBe(false);
		allowed = true;
		expect(editor.instance.can(cycle)).toBe(true);
	});
});

describe("a block type's key", () => {
	it('runs from the paragraph inside the alert, and nowhere else', async () => {
		const { editor } = await mounted(DOC);
		await pressKeyAt(editor, [0], 2, CTRL_7);
		await editor.settle();
		expect(editor.source()).toBe(DOC);
		await pressKeyAt(editor, [1, 0], 2, CTRL_7);
		await editor.settle();
		expect(editor.source()).toBe('intro\n\n%> [!TIP]\n%> inside\n');
	});

	it('runs on the alert nearest the caret when alerts nest', async () => {
		const { editor, ran } = await mounted('%> [!NOTE]\n%> %> [!WARNING]\n%> %> deep\n');
		await pressKeyAt(editor, [0, 0, 0], 2, CTRL_7);
		await editor.settle();
		expect(ran.map((block) => block.data.type)).toEqual(['WARNING']);
		expect(editor.source()).toBe('%> [!NOTE]\n%> %> [!NOTE]\n%> %> deep\n');
	});

	it("yields to a key the paragraph binds itself: bold and Enter stay the paragraph's", async () => {
		const bolded = makeAlerts((cycle) => ({ chords: { 'Mod+B': cycle, Enter: cycle } }));
		const { editor, ran } = await mounted(DOC, bolded);
		await pressKeyAt(editor, [1, 0], 2, { key: 'b', ctrlKey: true });
		await pressKeyAt(editor, [1, 0], 2, { key: 'Enter' });
		await editor.settle();
		expect(ran).toEqual([]);
		// The paragraph split, under the same head line.
		expect(editor.source()).toMatch(/^intro\n\n%> \[!NOTE\]\n%> in\n/);
	});

	it('asks the placed lookup nothing for typed letters inside an alert', async () => {
		const { editor } = await mounted(DOC);
		const el = surfaceAt(editor, [1, 0]);
		placeCaret(el, 6);
		enablePerfInstruments();
		resetPerfInstruments();
		try {
			for (const letter of 'abcdefghijklmnopqrst')
				await pressKeyAt(editor, [1, 0], 6, { key: letter });
			expect(perfSnapshot().placedLookups).toBe(0);
		} finally {
			disablePerfInstruments();
		}
	});
});

describe("a host's rebinding of a block type's key", () => {
	it('moves the key by value, and claimsChord and reservedChords follow it', async () => {
		const alerts = makeAlerts();
		const { editor } = await mounted(DOC, alerts, [
			{ kind: alerts.alert, chord: 'Mod+7', command: null },
			{ kind: alerts.alert, chord: 'Mod+Shift+7', command: alerts.cycle }
		]);
		const el = surfaceAt(editor, [1, 0]);
		placeCaret(el, 2);
		const press = (init: KeyboardEventInit) =>
			new KeyboardEvent('keydown', { bubbles: true, ...init });
		expect(editor.instance.claimsChord(press({ key: '7', ctrlKey: true, shiftKey: true }))).toBe(
			true
		);
		expect(editor.instance.claimsChord(press(CTRL_7))).toBe(false);
		expect(editor.instance.reservedChords()).toContain('Mod+Shift+7');
		await pressKeyAt(editor, [1, 0], 2, { key: '7', ctrlKey: true, shiftKey: true });
		await editor.settle();
		expect(editor.source()).toBe('intro\n\n%> [!TIP]\n%> inside\n');
	});
});

describe('the install pass', () => {
	it.each(['Mod+Z', 'Tab', 'Shift+Tab', 'Mod+'])(
		'leaves out a block type taking %s',
		async (key) => {
			const taking = makeAlerts((cycle) => ({
				chords: { [key]: cycle } as BlockCommon<AlertData>['chords']
			}));
			const { editor, errors } = await mounted(DOC, taking);
			expect(errors.map((e) => e.plugin)).toEqual(['alerts']);
			expect(editor.instance.plugins).not.toContain('alerts');
		}
	);

	it("keeps a chord off every editor that doesn't list the plugin", async () => {
		const { editor } = await mounted(DOC);
		const other = mountEditor({ source: 'plain\n' });
		await other.settle();
		expect(editor.instance.reservedChords()).toContain('Mod+7');
		expect(other.instance.reservedChords()).not.toContain('Mod+7');
	});

	it('reports a throw under its plugin', async () => {
		const boom = command<Block<AlertData>>({
			id: 'boom',
			title: 'Boom',
			run() {
				throw new Error('boom');
			}
		});
		const { editor, errors } = await mounted(
			DOC,
			makeAlerts(() => ({ chords: { 'Mod+7': boom } }))
		);
		await pressKeyAt(editor, [1, 0], 2, CTRL_7);
		expect(errors.map((e) => e.doing)).toEqual(['run alerts/boom']);
	});
});

// Miss-analysis: a placed command ran once, on the block around the selection's end, and no row
// held a selection across two blocks that both place it.
describe('a placed command over a selection across blocks', () => {
	const TWO = 'intro\n\n%> [!NOTE]\n%> one\n\n%> [!TIP]\n%> two\n';
	const BOTH = 'intro\n\n%> [!TIP]\n%> one\n\n%> [!WARNING]\n%> two\n';

	/** The whole document selected from the first alert's paragraph: Mod+A twice. */
	async function selectEverything(editor: Awaited<ReturnType<typeof mounted>>['editor']) {
		const surface = surfaceAt(editor, [1, 0]);
		placeCaret(surface, 1);
		await pressKey(surface, { key: 'a', ctrlKey: true });
		await pressKey(surface, { key: 'a', ctrlKey: true });
		await editor.settle();
	}

	it.each([
		[
			'`run` with no block',
			(m: Awaited<ReturnType<typeof mounted>>) => m.editor.instance.run(m.cycle)
		],
		[
			'its key',
			(m: Awaited<ReturnType<typeof mounted>>) => void pressKey(surfaceAt(m.editor, [1, 0]), CTRL_7)
		]
	])(
		'%s runs once on each covered block, as one undo step, and keeps the selection',
		async (_, go) => {
			const m = await mounted(TWO);
			await selectEverything(m.editor);
			const held = m.editor.instance.getSelection();
			go(m);
			await m.editor.settle();
			expect(m.editor.source()).toBe(BOTH);
			expect(m.ran).toHaveLength(2);
			expect(m.editor.instance.getSelection()).toEqual(held);
			await pressKey(surfaceAt(m.editor, [1, 0]), { key: 'z', ctrlKey: true });
			expect(m.editor.source()).toBe(TWO);
		}
	);
});
