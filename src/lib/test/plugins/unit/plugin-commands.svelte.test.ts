// @vitest-environment jsdom
// A plugin value's commands in a mounted editor: run by value, by `plugin/id` and by chord, only
// where the plugin is listed, with the chord tiers and the scoped editor each command gets.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { command, type Chord, type Command } from '#lib/schema/plugin-command.js';
import type { Editor, PluginError } from '#lib/schema/plugin-unit.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const CHORD_KEY = { key: 'j', ctrlKey: true, altKey: true };

/** A plugin whose one command records each run: the editor it got and the argument. */
function counter(name: string, spec: { chord?: Chord; when?: (arg: unknown) => boolean } = {}) {
	const runs: { editor: Editor; arg: unknown }[] = [];
	let made: Command<unknown> | undefined;
	const plugin = definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => {
			made = command<unknown>({
				id: 'count',
				title: 'Count',
				...(spec.chord && { chord: spec.chord as never }),
				when: spec.when && ((_editor, arg) => spec.when!(arg)),
				run: (editor, arg) => void runs.push({ editor, arg })
			});
			return { commands: [made] };
		}
	});
	return { plugin, runs, made: () => made! };
}

function mountWith(plugins: unknown[], extra: Record<string, unknown> = {}) {
	const errors: PluginError[] = [];
	const m = mountEditor({
		source: 'text\n',
		plugins: plugins as never,
		onError: (e) => errors.push(e),
		...extra
	});
	return { m, errors };
}

const messages = (errors: PluginError[]) =>
	errors.map((e) => (e.cause instanceof Error ? e.cause.message : String(e.cause)));

describe("a plugin value's command", () => {
	it('runs by value, by plugin/id and by its chord, with its own scoped editor', async () => {
		const c = counter('cmds', { chord: 'Mod+Alt+J' });
		const { m } = mountWith([c.plugin]);
		await m.settle();

		expect(c.made().id).toBe('cmds/count');
		expect(m.instance.run('cmds/count', 1)).toBe(true);
		expect(m.instance.run(c.made(), 2)).toBe(true);
		await pressKeyAt(m, [0], 0, CHORD_KEY);
		await m.settle();

		expect(c.runs.map((r) => r.arg)).toEqual([1, 2, undefined]);
		// One scoped editor per plugin, the same on every route.
		expect(new Set(c.runs.map((r) => r.editor)).size).toBe(1);
		expect(c.runs[0].editor).not.toBe(m.instance);
	});

	it('runs nowhere its plugin is not listed', async () => {
		const c = counter('cmds', { chord: 'Mod+Alt+J' });
		const listing = mountWith([c.plugin]).m;
		const other = mountWith([]).m;
		await listing.settle();

		expect(other.instance.run('cmds/count')).toBe(false);
		expect(other.instance.run(c.made(), undefined)).toBe(false);
		await pressKeyAt(other, [0], 0, CHORD_KEY);
		await other.settle();
		expect(c.runs).toEqual([]);
	});

	it('greys and refuses where `when` says no, reading the argument', async () => {
		const c = counter('cmds', { when: (arg) => arg === 'yes' });
		const { m } = mountWith([c.plugin]);
		await m.settle();

		expect(m.instance.can(c.made(), 'no')).toBe(false);
		expect(m.instance.run(c.made(), 'no')).toBe(false);
		expect(m.instance.can(c.made(), 'yes')).toBe(true);
		expect(m.instance.run(c.made(), 'yes')).toBe(true);
		expect(c.runs.map((r) => r.arg)).toEqual(['yes']);
	});

	it('reports a throw and a rejection under its plugin, naming the command', async () => {
		const boom = definePlugin({
			name: 'boom',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				commands: [
					command({
						id: 'now',
						title: 'Now',
						run: () => {
							throw new Error('now');
						}
					}),
					command({ id: 'later', title: 'Later', run: () => Promise.reject(new Error('later')) })
				]
			})
		});
		const { m, errors } = mountWith([boom]);
		await m.settle();

		m.instance.run('boom/now');
		m.instance.run('boom/later');
		await m.settle();
		expect(errors.map((e) => [e.plugin, e.doing])).toEqual([
			['boom', 'run boom/now'],
			['boom', 'run boom/later']
		]);
	});

	it('leaves its plugin out when an id is unusable or listed twice', async () => {
		const bad = (id: string, twice = false) =>
			definePlugin({
				name: `bad-${id}`,
				version: '1.0.0',
				editor: '*',
				contributes: () => {
					const one = command({ id, title: id, run: () => {} });
					return { commands: twice ? [one, command({ id, title: id, run: () => {} })] : [one] };
				}
			});
		const { m, errors } = mountWith([bad('Up'), bad('dup', true)]);
		await m.settle();
		expect(m.instance.plugins).toEqual([]);
		expect(messages(errors)).toEqual([
			`plugin 'bad-Up' has a command id "Up"; lowercase first letter, then letters/digits/hyphens`,
			`plugin 'bad-dup' lists two commands with the id "bad-dup/dup"`
		]);
	});
});

// Three tiers, highest first: a chord the editor takes, the host's `keybindings`, list order.
describe("a command's chord", () => {
	it('refuses its plugin when the editor takes the chord everywhere', async () => {
		const find = counter('finder', { chord: 'Mod+F' });
		const undo = counter('undoer', { chord: 'Mod+Z' });
		const { m, errors } = mountWith([find.plugin, undo.plugin]);
		await m.settle();
		expect(m.instance.plugins).toEqual([]);
		expect(messages(errors)).toEqual([
			`plugin 'finder' claims the chord "Mod+F", which search takes`,
			`plugin 'undoer' claims the chord "Mod+Z", which undo or redo takes`
		]);
	});

	it("yields to the host's keybindings", async () => {
		const c = counter('cmds', { chord: 'Mod+Alt+J' });
		const { m } = mountWith([c.plugin], {
			keybindings: [{ chord: 'Mod+Alt+J', command: null }]
		});
		await m.settle();
		await pressKeyAt(m, [0], 0, CHORD_KEY);
		await m.settle();
		expect(c.runs).toEqual([]);
	});

	it('goes to the plugin listed first, and the later one is left out', async () => {
		const first = counter('first', { chord: 'Mod+Alt+J' });
		const second = counter('second', { chord: 'Mod+Alt+j' as Chord });
		const { m, errors } = mountWith([first.plugin, second.plugin]);
		await m.settle();
		await pressKeyAt(m, [0], 0, CHORD_KEY);
		await m.settle();

		expect(first.runs).toHaveLength(1);
		expect(m.instance.plugins).toEqual(['first']);
		expect(messages(errors)).toEqual([
			`plugin 'second' shares the chord "Mod+Alt+j" with 'first', listed before it, so it's left out`
		]);
	});

	it('binds only to a command that runs without an argument, since a key supplies none', () => {
		const run = () => {};
		command({ id: 'bare', title: 'Bare', chord: 'Mod+Alt+B', run });
		command<string | undefined>({ id: 'maybe', title: 'Maybe', chord: 'Mod+Alt+M', run });
		// @ts-expect-error a key hands a command no string
		command<string>({ id: 'word', title: 'Word', chord: 'Mod+Alt+W', run });
	});

	// Miss-analysis: the claim check had no caller, so no row fed it a command's chord.
	it('is one report when malformed, and no keymap warning', async () => {
		const c = counter('keys', { chord: 'Ctrl+B' as Chord });
		const { m, errors } = mountWith([c.plugin]);
		await m.settle();
		expect(messages(errors)).toEqual([
			`plugin 'keys' claims the chord "Ctrl+B", which isn't one: unrecognized modifier "Ctrl" (use Mod/Alt/Shift)`
		]);
		expect(takeDevWarns()).toEqual([]);
	});
});

describe('the editor a command gets', () => {
	/** A plugin whose `setup` listens for edits and whose command records the editor it got. */
	function listening() {
		const seen = { setup: [] as Editor[], run: [] as Editor[], edits: 0 };
		const plugin = definePlugin({
			name: 'listening',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				setup(editor) {
					seen.setup.push(editor);
					editor.on('edit', () => seen.edits++);
				},
				commands: [command({ id: 'note', title: 'Note', run: (e) => void seen.run.push(e) })]
			})
		});
		return { plugin, seen };
	}

	it("is its plugin's `setup` editor, kept by a `use` that keeps the plugin", async () => {
		const { plugin, seen } = listening();
		const { m } = mountWith([plugin]);
		await m.settle();
		m.instance.run('listening/note');
		m.instance.use([plugin]);
		m.instance.run('listening/note');

		expect(seen.run).toEqual([seen.setup[0], seen.setup[0]]);
		expect(seen.setup).toHaveLength(1);
	});

	it('goes with a `use` that turns the plugin off, its listeners disposed', async () => {
		const { plugin, seen } = listening();
		const { m } = mountWith([plugin]);
		await m.settle();
		m.instance.run('listening/note');
		m.instance.use([]);
		await m.instance.insertMarkdown('more\n');
		await m.settle();
		expect(seen.edits).toBe(0);

		m.instance.use([plugin]);
		m.instance.run('listening/note');
		expect(seen.run[1]).not.toBe(seen.run[0]);
		expect(seen.run[1]).toBe(seen.setup[1]);
	});
});
