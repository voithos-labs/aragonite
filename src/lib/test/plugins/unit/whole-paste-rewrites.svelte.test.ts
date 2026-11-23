// @vitest-environment jsdom
// A plugin value's whole-paste rewrites in a mounted editor: every route a paste takes asks them
// once, before anything reads where the paste lands, and the paste lands as their answer pasted
// with no plugin would; the editor's own copy and plain text ask none; they chain in list order.
// Miss-analysis: a content rewrite existed only as a process-wide transform run where a paste lands
// as blocks, so no row pasted one line into text, a cell or a code body under one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	blockRewrite,
	builtin,
	definePlugin,
	pasteRewrite,
	type EditorPlugin,
	type PasteRewrite
} from '#lib/plugin.js';
import { OWN_CLIPBOARD_TYPE } from '#lib/browser/clipboard.js';
import type { Doc } from '#lib/schema/doc-view.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { listGrammar } from '#lib/schema/own-syntax.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { insertBy } from '#lib/test/harness/insertion-routes.js';
import { rewritePaste } from '#lib/testing.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

type Into = (text: string) => string | null;

/** A plugin of one whole-paste rewrite answering with `into`, recording each paste it reads. */
function rewriting(into: Into, name = 'whole', asked: string[] = []) {
	const plugin = definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			pasteRewrites: [
				pasteRewrite({
					name: 'all',
					sample: 'wow!! ok',
					into: (pasted) => (asked.push(pasted.text), into(pasted.text))
				})
			]
		})
	});
	return { plugin: plugin as unknown as EditorPlugin, asked };
}

async function mounted(source: string, plugins: EditorPlugin[] = []) {
	const errors: PluginError[] = [];
	const editor = mountEditor({ source, plugins, onError: (error) => errors.push(error) });
	await editor.settle();
	return { editor, errors };
}

type Mounted = Awaited<ReturnType<typeof mounted>>['editor'];
type Place = (editor: Mounted) => Promise<HTMLElement>;

const point = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** The selection from `anchor` to `focus`; resolves to the element a paste arrives on. */
const select =
	(anchor: SelectionPoint, focus = anchor): Place =>
	async (editor) => {
		await editor.instance.setSelection({ anchor, focus });
		await editor.settle();
		return document.activeElement as HTMLElement;
	};

/** Pastes `text` from outside where the caret is; `own` is the editor's own entry, `plain` sends the
 *  plain-paste chord first. */
async function pasteOn(
	editor: Mounted,
	at: HTMLElement,
	text: string,
	own?: string,
	plain = false
) {
	if (plain) await pressKey(at, { key: 'V', ctrlKey: true, shiftKey: true });
	const event = new Event('paste', { bubbles: true, cancelable: true });
	const types = own ? ['text/plain', OWN_CLIPBOARD_TYPE] : ['text/plain'];
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types,
			getData: (type: string) =>
				type === 'text/plain' ? text : type === OWN_CLIPBOARD_TYPE ? (own ?? '') : '',
			files: [],
			items: []
		}
	});
	at.dispatchEvent(event);
	await editor.settle();
}

/** The guide's example: text with `!!` in it shouts. */
const shout: Into = (text) => (text.includes('!!') ? text.toUpperCase() : null);

const TEXT = 'intro\n\nmiddle\n\nafter\n';
const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
const acrossText = select(point([0], 2), point([2], 2));

describe("the guide's shout", () => {
	it('shouts a paste with `!!` on an empty line, and keeps one without', async () => {
		const { plugin } = rewriting(shout);
		const { editor } = await mounted('intro\n\n\n', [plugin]);
		await pasteOn(editor, await select(point([1], 0))(editor), 'wow!! ok');
		expect(editor.source()).toBe('intro\n\nWOW!! OK\n');
		await pasteOn(editor, await select(point([1], 8))(editor), ' calm');
		expect(editor.source()).toBe('intro\n\nWOW!! OK calm\n');
	});
});

// Each place a paste can land, the clipboard pasted there, and an answer.
const LANDINGS: [string, string, Place, string, Into][] = [
	['one line after text', TEXT, select(point([0], 5)), 'wow!! ok', shout],
	['one line mid-text', TEXT, select(point([1], 3)), 'wow!! ok', shout],
	['one line in a quote', '> quoted\n', select(point([0, 0], 6)), 'wow!! ok', shout],
	['one line in a list item', '- item\n- two\n', select(point([0, 0, 0], 4)), 'wow!! ok', shout],
	['over a selection across blocks', TEXT, acrossText, 'one!!\n\ntwo', shout],
	['over a range in one block', TEXT, select(point([1], 1), point([1], 4)), 'wow!! ok', shout],
	['in a table cell', TABLE, select(point([0, 1, 0], 1)), 'wow!! ok', shout],
	['in a table cell, a grid', TABLE, select(point([0, 1, 0], 1)), 'x!!\ty', shout],
	['in a table cell, blocks', TABLE, select(point([0, 1, 0], 1)), '> q!!\n\nmore', shout],
	['in a code body', '```\ncode\n```\n', select(point([0], 8)), 'wow!! ok', shout],
	['one line answered as two blocks', TEXT, select(point([0], 5)), 'two', () => '# One\n\nTwo'],
	[
		'one line in a cell answered as blocks',
		TABLE,
		select(point([0, 1, 0], 1)),
		'two',
		() => '# One\n\nTwo'
	],
	['two lines answered as one line', TEXT, select(point([0], 5)), 'two\nlines\n', () => 'one']
];

describe('a whole-paste rewrite where a paste lands', () => {
	it.each(LANDINGS)(
		'is asked once about %s and lands what a paste of its answer lands, as one undo step',
		async (_, doc, place, clip, into) => {
			const { plugin, asked } = rewriting(into);
			const { editor } = await mounted(doc, [plugin]);
			await pasteOn(editor, await place(editor), clip);
			const landed = editor.source();
			expect(asked).toEqual([clip]);
			expect(landed).not.toBe(doc);
			await editor.settle();
			await pressKey(document.activeElement!, { key: 'z', ctrlKey: true });
			await editor.settle();
			expect(editor.source()).toBe(doc);
			await destroyMountedEditors();
			const control = await mounted(doc);
			await pasteOn(control.editor, await place(control.editor), into(clip) ?? clip);
			expect(landed).toBe(control.editor.source());
		}
	);
});

// Miss-analysis: no row drove a route to the paste entry besides a paste event under a content
// rewrite, so a route that skipped it would have passed.
describe('every route to the paste entry asks it once', () => {
	const ROUTES: [string, (editor: Mounted, text: string) => Promise<unknown>][] = [
		['insertMarkdown', (editor, text) => editor.instance.insertMarkdown(text)],
		[
			'insertMarkdown below',
			(editor, text) => editor.instance.insertMarkdown(text, { placement: 'below' })
		],
		[
			"the right-click menu's Paste",
			async (editor, text) => {
				Object.defineProperty(navigator, 'clipboard', {
					value: { readText: async () => text, writeText: async () => {} },
					configurable: true
				});
				document.activeElement!.dispatchEvent(
					new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
				);
				await editor.settle();
				[...document.querySelectorAll<HTMLElement>('[role="menuitem"], .md-menu-item')]
					.find((row) => row.textContent?.trim() === 'Paste')!
					.click();
				await editor.settle();
			}
		],
		[
			"the host's answer to a pasted image",
			async (editor, text) => {
				editor.props.onPasteImage = async () => text;
				const event = new Event('paste', { bubbles: true, cancelable: true });
				const file = new File(['x'], 'a.png', { type: 'image/png' });
				Object.defineProperty(event, 'clipboardData', {
					value: { types: ['Files'], getData: () => '', files: [file], items: [] }
				});
				document.activeElement!.dispatchEvent(event);
				await editor.settle();
				await editor.settle();
			}
		]
	];

	it.each(ROUTES)('%s', async (_, route) => {
		const { plugin, asked } = rewriting(shout);
		const { editor } = await mounted(TEXT, [plugin]);
		await select(point([0], 5))(editor);
		await route(editor, 'wow!! ok');
		await editor.settle();
		const landed = editor.source();
		expect(asked).toEqual(['wow!! ok']);
		await destroyMountedEditors();
		const control = await mounted(TEXT);
		await select(point([0], 5))(control.editor);
		await route(control.editor, 'WOW!! OK');
		await control.editor.settle();
		expect(landed).toBe(control.editor.source());
	});

	it("the host's answer to an image pasted while a range came to be held", async () => {
		const { plugin, asked } = rewriting(shout);
		const { editor } = await mounted(TEXT, [plugin]);
		let release: (md: string) => void = () => {};
		editor.props.onPasteImage = () => new Promise<string>((done) => (release = done));
		await select(point([0], 5))(editor);
		const event = new Event('paste', { bubbles: true, cancelable: true });
		const file = new File(['x'], 'a.png', { type: 'image/png' });
		Object.defineProperty(event, 'clipboardData', {
			value: { types: ['Files'], getData: () => '', files: [file], items: [] }
		});
		document.activeElement!.dispatchEvent(event);
		await editor.settle();
		await acrossText(editor);
		release('wow!! ok');
		await editor.settle();
		await editor.settle();
		expect(asked).toEqual(['wow!! ok']);
		expect(editor.source()).toBe('inWOW!! OKter\n');
	});
});

describe('a whole-paste rewrite is never asked', () => {
	it("about the editor's own copy pasted back", async () => {
		const { plugin, asked } = rewriting(shout);
		const { editor } = await mounted('wow!! ok\n\nend\n', [plugin]);
		await select(point([0], 0), point([0], 8))(editor);
		const data: Record<string, string> = {};
		const copy = new Event('copy', { bubbles: true, cancelable: true });
		Object.defineProperty(copy, 'clipboardData', {
			value: { types: [], getData: () => '', setData: (t: string, v: string) => void (data[t] = v) }
		});
		document.activeElement!.dispatchEvent(copy);
		await editor.settle();
		expect(data[OWN_CLIPBOARD_TYPE]).toBeTruthy();
		await pasteOn(
			editor,
			await select(point([1], 3))(editor),
			data['text/plain'],
			data[OWN_CLIPBOARD_TYPE]
		);
		expect(asked).toEqual([]);
		expect(editor.source()).toBe('wow!! ok\n\nendwow!! ok\n');
	});

	it('about a plain paste', async () => {
		const { plugin, asked } = rewriting(shout);
		const { editor } = await mounted(TEXT, [plugin]);
		await pasteOn(editor, await select(point([0], 5))(editor), 'wow!! ok', undefined, true);
		expect(asked).toEqual([]);
		expect(editor.source()).toBe('introwow!! ok\n\nmiddle\n\nafter\n');
	});
});

// Miss-analysis: an empty answer was given only to a rewrite by type, which a paste of one line
// into text never asks.
describe('an answer of nothing', () => {
	it.each<[string, Place]>([
		['at a caret in text', select(point([0], 5))],
		['over a selection across blocks', acrossText],
		['in a table cell', select(point([0, 1, 0], 1))]
	])('pastes nothing %s', async (_, place) => {
		const doc = TEXT + '\n' + TABLE;
		const { plugin } = rewriting(() => '');
		const { editor } = await mounted(doc, [plugin]);
		await pasteOn(editor, await place(editor), 'gone');
		expect(editor.source()).toBe(doc);
	});

	it('leaves undo nothing of its own', async () => {
		const { plugin } = rewriting(() => '');
		const { editor } = await mounted(TEXT, [plugin]);
		await insertBy('hardware key', await select(point([2], 5))(editor), 'Q');
		await editor.settle();
		await pasteOn(editor, await acrossText(editor), 'gone');
		await pressKey(document.activeElement!, { key: 'z', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe(TEXT);
	});
});

describe('whole-paste rewrites chain', () => {
	it('in plugin list order, each reading the paste the one before left', async () => {
		const first = rewriting((text) => `${text} one`, 'first');
		const keeps = rewriting(() => null, 'keeps');
		const last = rewriting((text) => `${text} two`, 'last');
		const { editor } = await mounted(TEXT, [first.plugin, keeps.plugin, last.plugin]);
		await pasteOn(editor, await select(point([0], 5))(editor), ' zero');
		expect([first.asked, keeps.asked, last.asked]).toEqual([
			[' zero'],
			[' zero one'],
			[' zero one']
		]);
		expect(editor.source()).toBe('intro zero one two\n\nmiddle\n\nafter\n');
	});

	it('past one that throws, which is reported and kept', async () => {
		const throws = rewriting(() => {
			throw new Error('boom');
		}, 'throws');
		const last = rewriting((text) => `${text} two`, 'last');
		const { editor, errors } = await mounted(TEXT, [throws.plugin, last.plugin]);
		await pasteOn(editor, await select(point([0], 5))(editor), ' zero');
		expect(last.asked).toEqual([' zero']);
		expect(errors.map(({ plugin, doing }) => [plugin, doing])).toEqual([
			['throws', 'rewrite paste']
		]);
		expect(editor.source()).toBe('intro zero two\n\nmiddle\n\nafter\n');
	});

	it('no further than an answer of nothing', async () => {
		const empties = rewriting(() => '', 'empties');
		const last = rewriting((text) => `${text} two`, 'last');
		const { editor } = await mounted(TEXT, [empties.plugin, last.plugin]);
		await pasteOn(editor, await select(point([0], 5))(editor), ' zero');
		expect(last.asked).toEqual([]);
		expect(editor.source()).toBe(TEXT);
	});
});

// The awkward shapes a paste's text arrives in, at the whole-paste rewrite and, after it, at a
// rewrite by type through `ctx.pasted`.
describe('the pasted text', () => {
	/** What each form reads of a paste of `clip` at `place`: the whole paste's text, and a by-type
	 *  rewrite's `pasted.text` with the slice its block's offsets name. */
	async function reads(doc: string, place: Place, paste: (editor: Mounted) => Promise<unknown>) {
		const whole: string[] = [];
		const byType: { pasted: string; at: string }[] = [];
		const plugin = definePlugin({
			name: 'reads',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				pasteRewrites: [
					pasteRewrite({
						name: 'reads',
						sample: 'x',
						into: (pasted: Doc) => (whole.push(pasted.text), pasted.text.replace('quiet', 'LOUD'))
					})
				],
				blockRewrites: [
					blockRewrite({
						from: builtin.blocks.heading,
						into: (block, { pasted }) => {
							byType.push({ pasted: pasted.text, at: pasted.text.slice(block.from, block.to) });
							return null;
						}
					})
				]
			})
		}) as unknown as EditorPlugin;
		const { editor } = await mounted(doc, [plugin]);
		await place(editor);
		await paste(editor);
		return { whole, byType };
	}
	const pasted = (text: string) => async (editor: Mounted) =>
		pasteOn(editor, document.activeElement as HTMLElement, text);

	it.each<[string, string, Place, (editor: Mounted) => Promise<unknown>, string]>([
		[
			'a clipboard, its last line ending in',
			TEXT,
			select(point([0], 5)),
			pasted('a\n# quiet\n'),
			'a\n# quiet\n'
		],
		[
			'a CRLF clipboard, as LF',
			TEXT,
			select(point([0], 5)),
			pasted('a\r\n# quiet\r\n'),
			'a\n# quiet\n'
		],
		[
			'insertMarkdown, less the one line ending it drops',
			TEXT,
			select(point([0], 5)),
			(editor) => editor.instance.insertMarkdown('a\n# quiet\n'),
			'a\n# quiet'
		],
		[
			'a paste in a quote, with no markers of the quote',
			'> quoted\n',
			select(point([0, 0], 6)),
			pasted('a\n# quiet\n'),
			'a\n# quiet\n'
		],
		[
			'a paste in a table cell, untrimmed',
			TABLE,
			select(point([0, 1, 0], 1)),
			pasted(' a\n# quiet\n'),
			' a\n# quiet\n'
		]
	])('%s', async (_, doc, place, paste, text) => {
		const { whole, byType } = await reads(doc, place, paste);
		expect(whole).toEqual([text]);
		expect(byType.map((read) => read.at.trimEnd())).toEqual(byType.length ? ['# LOUD'] : []);
		for (const read of byType) expect(read.pasted).toContain('# LOUD');
	});
});

describe('installing a whole-paste rewrite', () => {
	const refusal = (rewrites: unknown[]) => {
		const errors: PluginError[] = [];
		const plugin = definePlugin({
			name: 'odd',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ pasteRewrites: rewrites as PasteRewrite[] })
		});
		const { units } = listGrammar([plugin], (error) => errors.push(error));
		return {
			kept: units.map((unit) => unit.name),
			said: errors.map((e) => (e.cause as Error).message)
		};
	};
	const into = () => null;

	it.each<[string, unknown[], string]>([
		['with no name', [{ sample: 'x', into }], "plugin 'odd' has a paste rewrite with no `name`"],
		[
			'twice under one name',
			[
				{ name: 'a', sample: 'x', into },
				{ name: 'a', sample: 'y', into }
			],
			`plugin 'odd' lists two paste rewrites named "a"`
		],
		[
			'with no `into`',
			[{ name: 'a', sample: 'x' }],
			`plugin 'odd' has the paste rewrite "a" with no \`into\``
		],
		[
			'carrying a `from`',
			[{ name: 'a', sample: 'x', from: builtin.blocks.heading, into }],
			`plugin 'odd' has the paste rewrite "a" with a \`from\`: a rewrite by block type goes in \`blockRewrites\``
		]
	])('leaves the plugin out %s', (_, rewrites, said) => {
		expect(refusal(rewrites)).toEqual({ kept: [], said: [said] });
	});
});

// Miss-analysis: the helper's rows compared it with itself, so a helper that skipped the
// whole-paste rewrites would have agreed with every one of them.
describe('rewritePaste', () => {
	it('answers what the editor pastes once both forms ran', async () => {
		const both = definePlugin({
			name: 'both',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				pasteRewrites: [pasteRewrite({ name: 'loud', sample: 'x!!', into: (p) => shout(p.text) })],
				blockRewrites: [
					blockRewrite({
						from: builtin.blocks.heading,
						into: (block, { pasted }) => `# ${block.body} of ${pasted.blocks.length}`
					})
				]
			})
		}) as unknown as EditorPlugin;
		const clip = '# quiet!!\n\nand more\n';
		const answer = rewritePaste(clip, [both]);
		expect(answer).toBe('# QUIET!! of 2\n\nAND MORE\n');
		const { editor } = await mounted(TEXT, [both]);
		await pasteOn(editor, await acrossText(editor), clip);
		const landed = editor.source();
		await destroyMountedEditors();
		const control = await mounted(TEXT);
		await pasteOn(control.editor, await acrossText(control.editor), answer);
		expect(landed).toBe(control.editor.source());
	});
});
