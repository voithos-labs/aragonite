// @vitest-environment jsdom
// Text pasted into literal text (a code body, indented code, a plugin's literal leaf) is code, so no
// paste rewrite of either form reads it, by any route, and it lands as with no plugin; a title row
// reads inline Markdown, so a whole-paste rewrite reads a paste there.
// Miss-analysis: the whole-paste rows listed a code body among the places a rewrite reads, and no row
// asked whether a paste into code is Markdown, so a rewrite's answer landed in code as its source.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	blockRewrite,
	builtin,
	definePlugin,
	fencedBlock,
	lineBlock,
	pasteRewrite,
	type EditorPlugin
} from '#lib/plugin.js';
import { registeredAdmonitions } from '#lib/test/harness/registered-admonitions.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const shout = (text: string) => (text.includes('!!') ? text.toUpperCase() : null);

/** Both forms of rewrite, each shouting text with `!!` in it, and what each was asked. */
function rewriting() {
	const asked: string[] = [];
	const plugin = definePlugin({
		name: 'loud',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			pasteRewrites: [
				pasteRewrite({
					name: 'all',
					sample: 'wow!! ok',
					into: (pasted) => (asked.push(`whole ${pasted.text}`), shout(pasted.text))
				})
			],
			blockRewrites: [
				blockRewrite({
					from: builtin.blocks.paragraph,
					into: (block) => (asked.push(`type ${block.text}`), shout(block.text))
				})
			]
		})
	});
	return { plugin: plugin as unknown as EditorPlugin, asked };
}

const literalLeaves = definePlugin({
	name: 'leaves',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'line',
				label: 'Line',
				match: /^%% (?<text>.*)$/,
				sample: '%% x',
				insert: { none: 'a test block type' }
			}),
			fencedBlock({
				name: 'fenced',
				label: 'Fenced',
				fence: { info: 'demo' },
				sample: '```demo\nx\n```',
				insert: { none: 'a test block type' }
			})
		]
	})
}) as unknown as EditorPlugin;

async function mounted(source: string, plugins: EditorPlugin[]) {
	const editor = mountEditor({ source, plugins: [literalLeaves, ...plugins] });
	await editor.settle();
	return editor;
}

type Mounted = Awaited<ReturnType<typeof mounted>>;

const point = (path: number[], offset: number): SelectionPoint => ({ path, offset });

async function select(editor: Mounted, anchor: SelectionPoint, focus = anchor) {
	await editor.instance.setSelection({ anchor, focus });
	await editor.settle();
}

function pasteEvent(text: string, files: File[] = []): Event {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types: files.length ? ['Files'] : ['text/plain'],
			getData: (type: string) => (type === 'text/plain' ? text : ''),
			files,
			items: []
		}
	});
	return event;
}

type Route = (editor: Mounted, text: string) => Promise<unknown>;

const ROUTES: [string, Route][] = [
	['a paste event', async (_, text) => document.activeElement!.dispatchEvent(pasteEvent(text))],
	['insertMarkdown', (editor, text) => editor.instance.insertMarkdown(text)],
	[
		"the host's answer to a pasted image",
		async (editor, text) => {
			editor.props.onPasteImage = async () => text;
			const file = new File(['x'], 'a.png', { type: 'image/png' });
			document.activeElement!.dispatchEvent(pasteEvent('', [file]));
			await editor.settle();
		}
	]
];

const CODE = '```\ncode\n```\n';

/** `text` pasted by `route` at the selection `place` makes, with the rewriting plugin listed and
 *  without it: the bytes each landed and what the rewrites were asked. */
async function bothWays(doc: string, place: (editor: Mounted) => Promise<void>, route: Route) {
	const { plugin, asked } = rewriting();
	const editor = await mounted(doc, [plugin]);
	await place(editor);
	await route(editor, 'one!! "two"');
	await editor.settle();
	const landed = editor.source();
	await destroyMountedEditors();
	const control = await mounted(doc, []);
	await place(control);
	await route(control, 'one!! "two"');
	await control.settle();
	return { asked, landed, control: control.source() };
}

describe('a paste into literal text asks no rewrite', () => {
	it.each(ROUTES)('in a code body, by %s', async (_, route) => {
		const { asked, landed, control } = await bothWays(
			CODE,
			(editor) => select(editor, point([0], 8)),
			route
		);
		expect(asked).toEqual([]);
		expect(landed).toBe(control);
		expect(landed).toContain('codeone!! "two"');
	});

	it.each<[string, string, SelectionPoint, SelectionPoint?]>([
		['over a range in a code body', CODE, point([0], 4), point([0], 8)],
		['in indented code', 'intro\n\n    code\n', point([1], 8)],
		['in a code body inside a quote', '> ```\n> code\n> ```\n', point([0, 0], 8)],
		["in a plugin's line block", '%% the text\n', point([0], 11)],
		["in a plugin's fenced block", '```demo\nfirst\n```\n', point([0], 13)]
	])('%s', async (_, doc, anchor, focus) => {
		const route = ROUTES[0][1];
		const { asked, landed, control } = await bothWays(
			doc,
			(editor) => select(editor, anchor, focus),
			route
		);
		expect(asked).toEqual([]);
		expect(landed).toBe(control);
		expect(landed).toContain('one!! "two"');
	});
});

describe('a paste on a literal block’s syntax', () => {
	it('lands as blocks above it, which a rewrite by type reads', async () => {
		const { plugin, asked } = rewriting();
		const editor = mountEditor({
			source: 'intro\n\n%% the text\n',
			plugins: [literalLeaves, plugin],
			presentationMode: 'source'
		});
		await editor.settle();
		await select(editor, point([1], 0));
		document.activeElement!.dispatchEvent(pasteEvent('one!!\n'));
		await editor.settle();
		expect(asked.filter((read) => read.startsWith('type'))).toEqual(['type one!!\n']);
		expect(editor.source()).toMatch(/^intro\n\nONE!!\n+%% the text\n$/);
	});

	it("leaves a draft's insert there as written", async () => {
		const { plugin, asked } = rewriting();
		const editor = mountEditor({
			source: 'intro\n\n%% the text\n',
			plugins: [literalLeaves, plugin],
			presentationMode: 'source'
		});
		await editor.settle();
		await select(editor, point([1], 0));
		await editor.instance.edit().insert('one!!\n\ntwo\n').commit();
		await editor.settle();
		expect(asked).toEqual([]);
		expect(editor.source()).toContain('one!!');
	});
});

describe('a paste at a link definition', () => {
	it('is read by a whole-paste rewrite, since its lines land as blocks under it', async () => {
		const { plugin, asked } = rewriting();
		const editor = await mounted('[ref]: /url\n', [plugin]);
		await select(editor, point([0], 11));
		document.activeElement!.dispatchEvent(pasteEvent('one!!\n\ntwo'));
		await editor.settle();
		expect(asked[0]).toBe('whole one!!\n\ntwo');
		expect(editor.source()).toContain('ONE!!');
	});
});

describe('a paste into a title row', () => {
	it('is read by a whole-paste rewrite, as inline Markdown', async () => {
		const { plugin, asked } = rewriting();
		const editor = await mounted(':::note Title\nbody\n:::\n', [registeredAdmonitions(), plugin]);
		const title = surfaceAt(editor, [0, 0]);
		placeCaret(title, ':::note Title'.length);
		title.dispatchEvent(pasteEvent(' one!!'));
		await editor.settle();
		expect(asked).toEqual(['whole  one!!']);
		expect(editor.source()).toBe(':::note Title ONE!!\nbody\n:::\n');
	});
});
