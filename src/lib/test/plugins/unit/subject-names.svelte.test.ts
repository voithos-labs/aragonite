// @vitest-environment jsdom
// What names a plugin's command, caret menu and paste rewrite carry, which a check row would key
// on: a command is `plugin/id` whether it's listed or only placed by a block type, and ids are unique
// in a plugin; two menus may share a trigger, and two rewrites a `from`, the first that takes it
// winning.
// Miss-analysis: no row asked whether these names are unique, since nothing keyed on them before.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	builtin,
	command,
	definePlugin,
	lineBlock,
	menu,
	type Plugin,
	type PluginError
} from '#lib/plugin.js';
import { rewrite } from '#lib/schema/paste-rewrite.js';
import type { Block } from '#lib/schema/doc-view.js';
import { listGrammar } from '#lib/schema/own-syntax.js';
import { findOpening } from '#lib/inline-menu/inline-menu-session.js';
import type { InlineMenuSource } from '#lib/inline-menu/types.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(destroyMountedEditors);

const NOT_INSERTED = { none: 'a fixture of the subject names suite' };

function pluginOf(name: string, contributes: () => object): Plugin {
	return definePlugin({ name, version: '1.0.0', editor: '*', contributes });
}

/** `plugins` installed with no editor, and every problem the install reported. */
function installed(plugins: Plugin[]) {
	const problems: string[] = [];
	const list = listGrammar(plugins, ({ cause }: PluginError) =>
		problems.push((cause as Error).message)
	);
	list.release();
	return { problems, contributions: list.contributions, units: list.units };
}

describe("a block action's command", () => {
	it("is named plugin/id though the plugin's commands don't list it", () => {
		const go = command<Block<never>>({ id: 'go', title: 'Go', run: () => true });
		const memo = lineBlock({
			name: 'memo',
			label: 'Memo',
			sample: '%%x',
			insert: NOT_INSERTED,
			match: /^%%(?<text>.*)$/,
			actions: [{ label: 'Go', command: go }]
		});
		const { problems, contributions } = installed([pluginOf('acts', () => ({ blocks: [memo] }))]);
		expect(problems).toEqual([]);
		expect(go.id).toBe('acts/go');
		expect(contributions.blockActions('acts/memo').map((row) => row.command.id)).toEqual([
			'acts/go'
		]);
	});

	it('shares its id with no other command of its plugin', () => {
		const action = command<Block<never>>({ id: 'go', title: 'Go', run: () => true });
		const listed = command({ id: 'go', title: 'Go too', run: () => true });
		const memo = lineBlock({
			name: 'memo',
			label: 'Memo',
			sample: '%%x',
			insert: NOT_INSERTED,
			match: /^%%(?<text>.*)$/,
			actions: [{ label: 'Go', command: action }]
		});
		const plugin = pluginOf('twice', () => ({ blocks: [memo], commands: [listed] }));
		const { problems, units } = installed([plugin]);
		expect(units).toEqual([]);
		expect(problems).toEqual([expect.stringMatching(/lists two commands with the id "twice\/go"/)]);
	});
});

describe('two caret menus on one trigger', () => {
	const slashOf = (label: string) =>
		menu({ label, trigger: '/', rows: () => [{ label }], pick: () => {} });

	it('install, from one plugin or from two', () => {
		const one = installed([pluginOf('pair', () => ({ menus: [slashOf('a'), slashOf('b')] }))]);
		expect(one.problems).toEqual([]);
		expect(one.contributions.menus.map(({ menu }) => menu.label)).toEqual(['a', 'b']);
		const two = installed([
			pluginOf('first', () => ({ menus: [slashOf('a')] })),
			pluginOf('second', () => ({ menus: [slashOf('b')] }))
		]);
		expect(two.problems).toEqual([]);
		expect(two.contributions.menus.map(({ plugin }) => plugin)).toEqual(['first', 'second']);
	});

	it('open the first listed that takes the query, the second only where it declines', () => {
		const source = (name: string, accepts?: (query: string) => boolean): InlineMenuSource => ({
			name,
			trigger: '/',
			accepts,
			items: () => []
		});
		const opening = (sources: InlineMenuSource[]) => findOpening(sources, 'x /ab', 5, 2);
		expect(opening([source('first'), source('second')])?.source.name).toBe('first');
		const declines = source('first', () => false);
		expect(opening([declines, source('second')])?.source.name).toBe('second');
	});
});

describe('two paste rewrites on one block type', () => {
	/** A plugin whose rewrite answers every pasted paragraph with `answer`. */
	const rewriting = (name: string, answer: string | null) =>
		pluginOf(name, () => ({
			rewrites: [rewrite({ from: builtin.blocks.paragraph, into: () => answer })]
		}));

	async function pasted(plugins: Plugin[]): Promise<string> {
		const editor = mountEditor({ source: 'intro\n\nafter\n', plugins });
		await editor.settle();
		const surface = surfaceAt(editor, [0]);
		placeCaret(surface, 5);
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', {
			value: {
				types: ['text/plain'],
				getData: (type: string) => (type === 'text/plain' ? 'x\n\ny\n' : ''),
				files: [],
				items: []
			}
		});
		surface.dispatchEvent(event);
		await editor.settle();
		return editor.source();
	}

	it('install, and the first listed that answers writes', async () => {
		const both = [rewriting('first', 'FIRST'), rewriting('second', 'SECOND')];
		expect(installed(both).problems).toEqual([]);
		const source = await pasted(both);
		expect(source).toContain('FIRST');
		expect(source).not.toContain('SECOND');
	});

	it('hand a block to the second where the first keeps it', async () => {
		const source = await pasted([rewriting('first', null), rewriting('second', 'SECOND')]);
		expect(source).toContain('SECOND');
	});

	it('install from one plugin too', () => {
		const twice = pluginOf('twice', () => ({
			rewrites: [
				rewrite({ from: builtin.blocks.paragraph, into: () => 'A' }),
				rewrite({ from: builtin.blocks.paragraph, into: () => 'B' })
			]
		}));
		const { problems, contributions } = installed([twice]);
		expect(problems).toEqual([]);
		expect(contributions.rewrites).toHaveLength(2);
	});
});
