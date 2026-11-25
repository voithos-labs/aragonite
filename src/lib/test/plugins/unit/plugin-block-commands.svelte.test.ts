// @vitest-environment jsdom
// A block type's keys and menu rows place commands that run on its block: by id or value from the
// caret, by the type's key from a block inside it, and by a host's rebinding of that key.
// Miss-analysis: block commands ran only through the process-wide `registerBlockCommand` registry,
// and no row ran a plugin block command by id from a value plugin (N17).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	command,
	definePlugin,
	lineBlock,
	type BoxDrawContext,
	type Command,
	type TextDrawContext
} from '#lib/plugin.js';
import { container } from '#lib/components/block-makers/container.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { BlockCommon } from '#lib/schema/block-shapes.js';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import type { Draft } from '#lib/schema/drafts.js';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	surfaceAt,
	typeInto
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
	vi.restoreAllMocks();
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
	when?: () => boolean,
	write: (draft: Draft, block: Block<AlertData>) => Draft = (draft, block) =>
		draft.data(block, { type: next(block.data.type) })
) {
	const ran: Block<AlertData>[] = [];
	const cycle = command<Block<AlertData>>({
		id: 'cycle',
		title: 'Next kind',
		when: when && (() => when()),
		run(editor, block) {
			ran.push(block);
			void write(editor.edit(), block).commit();
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

/** A leaf type `@@ `, its placed command `mark` logging the text of each block it runs on. */
function makeMemos(place: (mark: Command<Block<never>>) => Partial<BlockCommon<never>>) {
	const marked: string[] = [];
	const mark = command<Block<never>>({
		id: 'mark',
		title: 'Mark',
		run: (_, block) => void marked.push(`${block.text}@${block.from}`)
	});
	const memo = lineBlock({
		name: 'memo',
		label: 'Memo',
		match: /^@@ (?<text>.*)$/,
		sample: '@@ x',
		insert: { none: 'a test block type' },
		...place(mark)
	});
	const plugin = definePlugin({
		name: 'memos',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [memo] })
	});
	return { plugin, mark, marked };
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

	// Miss-analysis: every row handed a placed command a block of its own type, or none; an id
	// carries no type, so a host could hand it any block.
	it('refuses a block whose type does not place it, by id', async () => {
		const { editor, ran, errors } = await mounted(DOC);
		const paragraph = editor.instance.blockAt(1)!;
		expect(editor.instance.can('alerts/cycle', paragraph)).toBe(false);
		expect(editor.instance.run('alerts/cycle', paragraph)).toBe(false);
		await editor.settle();
		expect(ran).toEqual([]);
		expect(errors).toEqual([]);
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

// Miss-analysis: every key and menu row wrote through a draft, which finds a node by identity, so a
// block from a second reading of the document, placed nowhere (`from` at -1), still wrote.
describe("a placed command's block", () => {
	type Mounted = Awaited<ReturnType<typeof mounted>>['editor'];
	const openRow = async (editor: Mounted, label: string) => {
		const surface = surfaceAt(editor, [1, 0]);
		surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await editor.settle();
		const rows = () => [...document.querySelectorAll<HTMLElement>('.block-menu .md-menu-item')];
		rows()
			.find((el) => el.textContent?.trim() === 'Alert')!
			.dispatchEvent(new Event('pointerenter'));
		await editor.settle();
		rows()
			.find((el) => el.textContent?.trim() === label)!
			.click();
	};

	it.each([
		['its key, from the paragraph inside', (m: Mounted) => pressKeyAt(m, [1, 0], 2, CTRL_7)],
		['its menu row', (m: Mounted) => openRow(m, 'Next kind')]
	])('is placed, and the block the document hands out, run by %s', async (_, go) => {
		const places: number[][] = [];
		const alerts = makeAlerts(undefined, undefined, (draft, block) => {
			places.push([block.from, block.to]);
			return draft;
		});
		const { editor, ran } = await mounted(DOC, alerts);
		await go(editor);
		await editor.settle();
		expect(places).toEqual([[7, DOC.length]]);
		expect(ran[0]).toBe(editor.instance.doc.blocks[1]);
	});

	it("is placed when a leaf type's key runs it", async () => {
		const { plugin, marked } = makeMemos((mark) => ({ chords: { 'Mod+7': mark } }));
		const editor = mountEditor({ source: 'intro\n\n@@ note\n', plugins: [plugin] });
		await editor.settle();
		await pressKeyAt(editor, [1], 4, CTRL_7);
		expect(marked).toEqual(['@@ note\n@7']);
	});

	// Miss-analysis: the leaf row's block draws as plain text, which names no place, so its key falls
	// to the block nearest the caret; no key ran in a leaf the plugin draws, which hands over its own.
	it('is the drawn leaf its key landed in, the text typed in its opened picture written first', async () => {
		const { plugin, marked } = makeMemos((mark) => {
			const draw = (_: unknown, ctx: TextDrawContext) => {
				const dom = document.createElement('div');
				dom.append(document.createElement('span'), ctx.source);
				return { dom };
			};
			return { chords: { 'Mod+7': mark }, edit: 'source', draw } as Partial<BlockCommon<never>>;
		});
		const source = 'intro\n\n> @@ note\n';
		const editor = mountEditor({ source, plugins: [plugin] });
		await editor.settle();
		const picture = blockHostAt(editor, [1, 0]).querySelector('span')!;
		picture.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		picture.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await editor.settle();
		const text = surfaceAt(editor, [1, 0]);
		typeInto(text, '@@ note grown');
		expect(editor.source()).toBe(source);
		await pressKey(text, CTRL_7);
		await editor.settle();
		expect(marked).toEqual(['@@ note grown\n@9']);
	});

	// Miss-analysis: no row ran a key on a block held whole, and each block found from the caret
	// stood at the top level, where a path cut short still places it.
	it('is placed when its key lands on a box held whole, inside a quote', async () => {
		const { plugin, marked } = makeMemos((mark) => {
			const draw = (_: unknown, ctx: BoxDrawContext) => {
				const dom = document.createElement('button');
				dom.addEventListener('click', () => ctx.focusWhole());
				return { dom };
			};
			return { chords: { 'Mod+7': mark }, edit: 'box', draw } as Partial<BlockCommon<never>>;
		});
		const editor = mountEditor({ source: 'intro\n\n> @@ note\n', plugins: [plugin] });
		await editor.settle();
		blockHostAt(editor, [1, 0]).querySelector('button')!.click();
		await editor.settle();
		await pressKey(document.activeElement!, CTRL_7);
		expect(marked).toEqual(['@@ note\n@9']);
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

	it("yields to a key the paragraph binds itself: bold stays the paragraph's", async () => {
		const bolded = makeAlerts((cycle) => ({ chords: { 'Mod+B': cycle } }));
		const { editor, ran } = await mounted(DOC, bolded);
		await pressKeyAt(editor, [1, 0], 2, { key: 'b', ctrlKey: true });
		await editor.settle();
		expect(editor.instance.plugins).toContain('alerts');
		expect(ran).toEqual([]);
		expect(editor.source()).not.toBe(DOC);
	});

	it('runs a key no text edits with, Mod+Enter, from the paragraph inside', async () => {
		const entered = makeAlerts((cycle) => ({ chords: { 'Mod+Enter': cycle } }));
		const { editor, errors } = await mounted(DOC, entered);
		await pressKeyAt(editor, [1, 0], 2, { key: 'Enter', ctrlKey: true });
		await editor.settle();
		expect(errors).toEqual([]);
		expect(editor.source()).toBe('intro\n\n%> [!TIP]\n%> inside\n');
	});

	it("runs a leaf type's Backspace in its own text, mid-text included", async () => {
		const { plugin, marked } = makeMemos((mark) => ({ chords: { Backspace: mark } }));
		const errors: PluginError[] = [];
		const editor = mountEditor({
			source: '@@ note\n',
			plugins: [plugin],
			onError: (e) => errors.push(e)
		});
		await editor.settle();
		await pressKeyAt(editor, [0], 5, { key: 'Backspace' });
		expect(errors).toEqual([]);
		expect(marked).toEqual(['@@ note\n@0']);
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

	// Miss-analysis: the keys a container keeps as text keys of one platform only were installed and
	// never pressed under that platform's conventions, where the claim is they never reach it.
	it.each([
		['Alt+Q', 'a Mac, where Option types', 'MacIntel', { key: 'œ', altKey: true }, 0, false],
		['Alt+ArrowLeft', 'a Mac, where it moves a word', 'MacIntel', { key: 'ArrowLeft' }, 0, true],
		['Alt+Q', 'Windows', 'Win32', { key: 'q' }, 1, true],
		['Alt+ArrowLeft', 'Windows', 'Win32', { key: 'ArrowLeft' }, 1, true]
	])("a container's %s on %s", async (key, _, platform, press, runs, taken) => {
		vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
		const taking = makeAlerts((cycle) => ({
			chords: { [key]: cycle } as BlockCommon<AlertData>['chords']
		}));
		const { editor, ran } = await mounted(DOC, taking);
		const event = await pressKeyAt(editor, [1, 0], 2, { altKey: true, ...press });
		await editor.settle();
		expect(ran).toHaveLength(runs);
		expect(event.defaultPrevented).toBe(taken);
	});
});

// Miss-analysis: a command reached its block's drawing only through a key or a row, so a box's Edit,
// which has neither, could be listed nowhere that hands it a block.
describe('a command a block type lists in `commands`, with no key or row', () => {
	const listing = (cycle: Command<Block<AlertData>>) => ({
		chords: undefined,
		actions: undefined,
		commands: [cycle]
	});

	it.each([
		['a container', 'intro\n\n%> [!NOTE]\n%> inside\n', [1, 0], 'alerts'],
		['a line block', 'intro\n\n@@ note\n', [1], 'memos'],
		['a fenced block', 'intro\n\n```memo\nnote\n```\n', [1], 'fences']
	] as const)('runs on %s holding the caret, by id', async (_, source, path, plugin) => {
		const ran: string[] = [];
		const listed = command<Block<never>>({
			id: 'go',
			title: 'Go',
			run: (_editor, block) => void ran.push(block.type.name)
		});
		const common = { label: 'X', insert: { none: 'a test block type' }, commands: [listed] };
		const types = {
			alerts: () => makeAlerts(() => listing(listed as never)).alert,
			memos: () =>
				lineBlock({ ...common, name: 'memo', match: /^@@ (?<text>.*)$/, sample: '@@ x' }),
			fences: () =>
				fencedBlock({
					...common,
					name: 'fence',
					fence: { info: 'memo' },
					sample: '```memo\nx\n```'
				})
		};
		const block = types[plugin]();
		const owner = definePlugin({
			name: plugin,
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [block] })
		});
		const editor = mountEditor({ source, plugins: [owner] });
		await editor.settle();
		placeCaret(surfaceAt(editor, [...path]), 1);
		expect(editor.instance.run(`${plugin}/go`)).toBe(true);
		placeCaret(surfaceAt(editor, [0]), 1);
		expect(editor.instance.run(`${plugin}/go`)).toBe(false);
		expect(editor.instance.run(`${plugin}/go`, editor.instance.blockAt(0)!)).toBe(false);
		expect(ran).toEqual([block.name]);
	});

	it('adds no menu row and binds no key', async () => {
		const { editor, ran } = await mounted(DOC, makeAlerts(listing));
		expect(editor.instance.reservedChords()).not.toContain('Mod+7');
		await pressKeyAt(editor, [1, 0], 2, CTRL_7);
		const surface = surfaceAt(editor, [1, 0]);
		surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await editor.settle();
		const rows = [...document.querySelectorAll('.block-menu .md-menu-item')];
		expect(rows.map((el) => el.textContent?.trim())).not.toContain('Alert');
		expect(ran).toEqual([]);
	});

	it("runs from a host's key bound to it on the type", async () => {
		const alerts = makeAlerts(listing);
		const { editor } = await mounted(DOC, alerts, [
			{ kind: alerts.alert, chord: 'Mod+Shift+7', command: alerts.cycle }
		]);
		await pressKeyAt(editor, [1, 0], 2, { key: '7', ctrlKey: true, shiftKey: true });
		await editor.settle();
		expect(editor.source()).toBe('intro\n\n%> [!TIP]\n%> inside\n');
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

	// Miss-analysis: a container's key was checked against the editor's own chords only, and no row
	// pressed it mid-text in a paragraph inside, where it ran the command and deleted nothing.
	it.each([
		'Backspace',
		'Delete',
		'Enter',
		'Shift+Enter',
		'Mod+Backspace',
		'Shift+Q',
		'Mod+V',
		'Shift+ArrowUp',
		'Alt+Backspace'
	])('leaves out a container taking %s, a key the text inside edits with', async (key) => {
		const taking = makeAlerts((cycle) => ({
			chords: { [key]: cycle } as BlockCommon<AlertData>['chords']
		}));
		const { editor, errors } = await mounted(DOC, taking);
		expect(errors.map((e) => (e.cause as Error).message)).toEqual([
			`plugin 'alerts' claims the block key "${key}" on a container, which the text inside it keeps`
		]);
		expect(editor.instance.plugins).not.toContain('alerts');
	});

	// Each edits text on one platform only: Option types and moves a word on a Mac, AltGr is Ctrl+Alt
	// on Windows. There the keydown names the typed character or the keymaps yield it.
	it.each(['Alt+Q', 'Mod+Alt+Q', 'Alt+ArrowLeft'])(
		'keeps a container taking %s, a text key on one platform only',
		async (key) => {
			const taking = makeAlerts((cycle) => ({
				chords: { [key]: cycle } as BlockCommon<AlertData>['chords']
			}));
			const { editor, errors } = await mounted(DOC, taking);
			expect(errors).toEqual([]);
			expect(editor.instance.plugins).toContain('alerts');
		}
	);

	// Miss-analysis: a block key was checked against the editor's own chords and never against
	// another plugin's, whose editor-wide chord then ran inside the type's blocks with nobody told.
	it.each([
		['the block type', 'alerts'],
		['the command', 'other']
	])('leaves out %s listed after the plugin whose key it takes', async (_, left) => {
		const other = definePlugin({
			name: 'other',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				commands: [command({ id: 'hit', title: 'Hit', chord: 'Mod+7', run: () => {} })]
			})
		});
		const alerts = makeAlerts().plugin;
		const errors: PluginError[] = [];
		const editor = mountEditor({
			source: DOC,
			plugins: left === 'alerts' ? [other, alerts] : [alerts, other],
			onError: (error: PluginError) => errors.push(error)
		});
		await editor.settle();
		expect(errors.map((e) => e.plugin)).toEqual([left]);
		expect(editor.instance.plugins).not.toContain(left);
	});

	// Miss-analysis: a block type's icon was read nowhere, so nothing checked one it declared.
	it('leaves out a block type whose icon the menu cannot draw', async () => {
		const { editor, errors } = await mounted(
			DOC,
			makeAlerts(() => ({ icon: 'nope' as never }))
		);
		expect(errors.map((e) => (e.cause as Error).message)).toEqual([
			"plugin 'alerts' has a block type that names icon 'nope', which the menu cannot draw"
		]);
		expect(editor.instance.plugins).not.toContain('alerts');
	});

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

	// Miss-analysis: the range rows wrote data only, which leaves every other block's bytes alone; a
	// write that takes its block out re-reads the block after it, whose handle then finds nothing.
	it('runs a command that removes its block on every covered block, one undo step', async () => {
		const m = await mounted(
			TWO,
			makeAlerts(undefined, undefined, (draft, block) =>
				draft.replace({ from: block.from, to: block.to }, '')
			)
		);
		await selectEverything(m.editor);
		m.editor.instance.run(m.cycle);
		await m.editor.settle();
		expect(m.editor.source()).not.toContain('%>');
		await pressKey(surfaceAt(m.editor, [0]), { key: 'z', ctrlKey: true });
		expect(m.editor.source()).toBe(TWO);
	});

	// Miss-analysis: the range rows covered two alerts; with one covered, the run took the caret's
	// path, whose write collapses the selection.
	it.each([
		[
			'`run` with no block',
			(m: Awaited<ReturnType<typeof mounted>>) => m.editor.instance.run(m.cycle)
		],
		[
			'its key',
			(m: Awaited<ReturnType<typeof mounted>>) => void pressKey(surfaceAt(m.editor, [1, 0]), CTRL_7)
		]
	])('%s keeps a selection that covers one alert among paragraphs', async (_, go) => {
		const m = await mounted('intro\n\n%> [!NOTE]\n%> one\n\nlast\n');
		await selectEverything(m.editor);
		const held = m.editor.instance.getSelection();
		go(m);
		await m.editor.settle();
		expect(m.editor.source()).toBe('intro\n\n%> [!TIP]\n%> one\n\nlast\n');
		expect(m.editor.instance.getSelection()).toEqual(held);
	});

	// Miss-analysis: the range rows ended inside a block's text or at a leaf's first byte, never at
	// the first byte of a container's text, which the key still ran on with nothing of it selected.
	it('leaves out, by its key, the alert the range ends at the first byte of', async () => {
		const source = 'intro\n\n%> [!NOTE]\n%> one\n\n%> [!TIP]\n%> two\n\nafter\n';
		const m = await mounted(source);
		await m.editor.instance.setSelection({
			anchor: { path: [1, 0], offset: 0 },
			focus: { path: [2, 0], offset: 0 }
		});
		await m.editor.settle();
		const held = m.editor.instance.getSelection();
		await pressKey(surfaceAt(m.editor, [2, 0]), CTRL_7);
		await m.editor.settle();
		expect(m.editor.source()).toBe('intro\n\n%> [!TIP]\n%> one\n\n%> [!TIP]\n%> two\n\nafter\n');
		expect(m.editor.instance.getSelection()).toEqual(held);
	});

	// Miss-analysis: the key rows ended their selection inside an alert, so the key always landed
	// in a block that binds it; a selection that ends in a plain paragraph ran nothing.
	it('runs its key on each covered block when the key lands in a block that binds none', async () => {
		const source = '%> [!NOTE]\n%> one\n\n%> [!TIP]\n%> two\n\nlast\n';
		const m = await mounted(source);
		const surface = surfaceAt(m.editor, [0, 0]);
		placeCaret(surface, 1);
		await pressKey(surface, { key: 'a', ctrlKey: true });
		await pressKey(surface, { key: 'a', ctrlKey: true });
		await m.editor.settle();
		const last = surfaceAt(m.editor, [2]);
		last.focus();
		const press = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...CTRL_7 });
		expect(m.editor.instance.claimsChord(press)).toBe(true);
		await pressKey(last, CTRL_7);
		await m.editor.settle();
		expect(m.editor.source()).toBe('%> [!TIP]\n%> one\n\n%> [!WARNING]\n%> two\n\nlast\n');
		await pressKey(last, { key: 'z', ctrlKey: true });
		expect(m.editor.source()).toBe(source);
	});

	// Miss-analysis: every range row listed one plugin binding the key, so the first command found
	// was always the one whose blocks the range covers.
	it('runs the key of the type whose blocks it covers where another plugin binds it too', async () => {
		const memos = makeMemos((mark) => ({ chords: { 'Mod+7': mark } }));
		const alerts = makeAlerts();
		const source = '%> [!NOTE]\n%> one\n\n%> [!TIP]\n%> two\n\nlast\n';
		const editor = mountEditor({ source, plugins: [memos.plugin, alerts.plugin] });
		await editor.settle();
		const surface = surfaceAt(editor, [0, 0]);
		placeCaret(surface, 1);
		await pressKey(surface, { key: 'a', ctrlKey: true });
		await pressKey(surface, { key: 'a', ctrlKey: true });
		await editor.settle();
		await pressKey(surfaceAt(editor, [2]), CTRL_7);
		await editor.settle();
		expect(editor.source()).toBe('%> [!TIP]\n%> one\n\n%> [!WARNING]\n%> two\n\nlast\n');
		expect(memos.marked).toEqual([]);
	});

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
