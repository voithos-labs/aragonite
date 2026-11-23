// @vitest-environment jsdom
// A program's own insert in a mounted editor: a draft's `insert` and `insertBelow`, a caret menu's
// pick and a right-click insert row land as with no plugin listed and ask no paste rewrite, while `insertMarkdown` and a
// pasted clipboard still ask.
// Miss-analysis: every insert went in through the paste's one entry point, so a plugin's rewrite read the Markdown
// the plugin itself inserted, and no row drove an insert with a rewrite listed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	builtin,
	definePlugin,
	menu,
	registerPasteTransform,
	blockRewrite,
	type EditorPlugin,
	type MenuPick,
	type MenuRow
} from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { StubDataTransfer, dispatchClipboardEvent } from '#lib/test/harness/clipboard-events.js';
import { pressKey, settleEditor } from '#lib/test/harness/settle.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const asked: string[] = [];

// A `setup` plugin's paste transform: every quote line of the paste becomes REWRITTEN.
const textTransform = definePlugin({
	name: 'program-insert-transform',
	setup: () =>
		registerPasteTransform({
			name: 'program-insert-transform',
			transform: (text) => {
				asked.push(text);
				return /^> /m.test(text) ? text.replace(/^> .*$/gm, 'REWRITTEN') : null;
			}
		})
});

// A plugin value's rewrite by type: every pasted quote becomes REWRITTEN.
const byType = definePlugin({
	name: 'program-insert-by-type',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blockRewrites: [
			blockRewrite({
				from: builtin.blocks.blockquote,
				into: (block) => (asked.push(block.text), 'REWRITTEN')
			})
		]
	})
});

let onPick: (pick: MenuPick) => unknown = () => undefined;

// A `/` menu with one row, listed in every mount; `onPick` decides what the pick writes.
const picker = definePlugin({
	name: 'program-insert-picker',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		menus: [
			menu<MenuRow>({
				label: 'Insert',
				trigger: '/',
				rows: () => [{ label: 'Row' }],
				pick: (_row, pick) => void onPick(pick)
			})
		]
	})
}) as unknown as EditorPlugin;

const REWRITERS: [string, EditorPlugin[]][] = [
	['a paste transform', [textTransform]],
	['a rewrite by type', [byType as unknown as EditorPlugin]]
];

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

const menuRow = (label: RegExp) =>
	[...document.querySelectorAll<HTMLElement>('[role="menuitem"], .md-menu-item')].find((row) =>
		label.test(row.textContent?.trim() ?? '')
	);

/** Right-click at the caret, open the Insert flyout and pick the row labelled `label`. */
async function pickInsertRow(editor: MountedEditor, label: RegExp): Promise<void> {
	focused().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
	await editor.settle();
	const flyout = menuRow(/^Insert/)!;
	flyout.click();
	flyout.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
	await editor.settle();
	menuRow(label)!.click();
	await settleEditor();
	await editor.settle();
}

type Insert = (editor: MountedEditor, markdown: string) => Promise<unknown>;

/** A pick of the `/` menu's row at the caret, writing through `write`. */
function picked(write: (pick: MenuPick, markdown: string) => Promise<unknown>): Insert {
	return async (editor, markdown) => {
		let result: Promise<unknown> = Promise.resolve();
		onPick = (pick) => (result = write(pick, markdown));
		const surface = focused();
		const lead = surface.textContent ? `${surface.textContent} ` : '';
		// A space first, then the trigger and a letter, as keys arrive.
		for (const text of [lead, `${lead}/r`]) {
			surface.textContent = text;
			placeCaret(surface, text.length);
			surface.dispatchEvent(new InputEvent('input', { bubbles: true }));
			await editor.settle();
		}
		await pressKey(surface, { key: 'Enter' });
		await result;
		await editor.settle();
	};
}

const QUOTES = ['> q', 'x\n\n> q\n'];

/** Each way a program inserts, with the Markdown it is handed. */
const PROGRAM_INSERTS: [string, Insert, string[]][] = [
	['Draft.insert', (editor, markdown) => editor.instance.edit().insert(markdown).commit(), QUOTES],
	[
		'Draft.insertBelow',
		(editor, markdown) => editor.instance.edit().insertBelow(markdown).commit(),
		QUOTES
	],
	['a pick, insertBlock', picked((pick, markdown) => pick.insertBlock(markdown)), QUOTES],
	['a pick, insertBelow', picked((pick, md) => pick.insertBelow(md).commit()), QUOTES],
	['a pick, insert', picked((pick, markdown) => pick.insert(markdown).commit()), QUOTES],
	['the Quote insert row', (editor) => pickInsertRow(editor, /^Quote$/), ['its own "> "']]
];

const PASTES: [string, Insert][] = [
	['insertMarkdown', (editor, markdown) => editor.instance.insertMarkdown(markdown)],
	[
		'insertMarkdown below',
		(editor, markdown) => editor.instance.insertMarkdown(markdown, { placement: 'below' })
	],
	[
		'Ctrl+V',
		async (editor, markdown) => {
			dispatchClipboardEvent(focused(), 'paste', new StubDataTransfer({ 'text/plain': markdown }));
			await editor.settle();
		}
	]
];

const PLACES = ['after text', 'on an empty line'] as const;

/** What `insert` lands with `plugins` listed: the bytes, the caret, and the bytes after a typed `x`. */
async function landed(
	plugins: EditorPlugin[],
	place: (typeof PLACES)[number],
	insert: Insert,
	markdown: string
) {
	const editor = mountEditor({ source: 'abc\n', plugins: [picker, ...plugins] });
	await editor.settle();
	placeCaret(surfaceAt(editor, [0]), 3);
	await editor.settle();
	if (place === 'on an empty line') await pressHardwareKey(focused(), { key: 'Enter' });
	await editor.settle();
	asked.length = 0;
	await insert(editor, markdown);
	await editor.settle();
	const source = editor.source();
	const caret = editor.instance.getSelection();
	const row = { source, caret, asked: [...asked] };
	await pressHardwareKey(focused(), { key: 'x' });
	await editor.settle();
	const lettered = editor.source();
	await destroyMountedEditors();
	document.body.innerHTML = '';
	return { ...row, lettered };
}

describe("a program's own insert", () => {
	for (const [name, insert, payloads] of PROGRAM_INSERTS)
		for (const [rewriterName, plugins] of REWRITERS)
			for (const place of PLACES)
				for (const markdown of payloads)
					it(`${name} of ${JSON.stringify(markdown)} ${place} lands as with no plugin, under ${rewriterName}`, async () => {
						const plain = await landed([], place, insert, markdown);
						const listed = await landed(plugins, place, insert, markdown);
						expect(listed).toEqual(plain);
						expect(plain.source).toContain('>');
						expect(listed.asked).toEqual([]);
						expect(listed.source).not.toContain('REWRITTEN');
					});
});

describe('a paste, and the insert named for one', () => {
	for (const [name, insert] of PASTES)
		for (const [rewriterName, plugins] of REWRITERS)
			it(`${name} of a quote on an empty line is still rewritten by ${rewriterName}`, async () => {
				const listed = await landed(plugins, 'on an empty line', insert, 'x\n\n> q\n');
				expect(listed.asked.length).toBeGreaterThan(0);
				expect(listed.source).toContain('REWRITTEN');
			});
});
