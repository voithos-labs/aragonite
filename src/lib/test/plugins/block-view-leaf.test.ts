// @vitest-environment jsdom
// A plugin leaf drawn by a DOM view edits like the same leaf drawn by a Svelte component: each row
// runs over both forms, then the DOM view's own lifecycle and element rules (G1.136).
// Miss-analysis: new surface; the rows the scratch probe proved, kept so the two forms can't drift.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchKey, pressKey } from '#lib/test/harness/settle.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { newestEntryCaret } from '../harness/undo-entry';
import { BLOCK_CONTENT_SELECTOR } from '#lib/caret/block-content-selector.js';
import { blockContentElAt } from '#lib/caret/block-el-lookup.js';
import { PLAIN_LEAF_FORMS, domPlainLeaf, markerLeafPlugin, newViewLog } from './fixtures/dom-views';
import { defineBlockView, type BlockView } from '#lib/plugin.js';

const SOURCE = 'intro\n\n@@ abcd\n\noutro\n';
const LEAF = [1];

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function mountLeaf(view: BlockView, source = SOURCE): MountedEditor {
	return mountEditor({ source, plugins: [markerLeafPlugin(view)] });
}

function paste(target: EventTarget, text: string): void {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [] }
	});
	target.dispatchEvent(e);
}

describe.each(PLAIN_LEAF_FORMS)('a plain plugin leaf drawn by $form', ({ view }) => {
	it('is one editable text node holding the block’s text, as a textbox', async () => {
		const editor = mountLeaf(view());
		await editor.settle();
		const el = surfaceAt(editor, LEAF);
		expect(el.getAttribute('contenteditable')).toBe('true');
		expect(el.getAttribute('role')).toBe('textbox');
		expect(el.textContent).toBe('@@ abcd');
		expect(el.childNodes).toHaveLength(1);
	});

	it('commits what is typed, and Ctrl+Z writes the old text back into the element', async () => {
		const editor = mountLeaf(view());
		await editor.settle();
		const el = surfaceAt(editor, LEAF);
		typeInto(el, '@@ abcdX');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcdX'));

		await pressKey(surfaceAt(editor, LEAF), { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe(SOURCE);
		expect(surfaceAt(editor, LEAF).textContent).toBe('@@ abcd');
	});

	// A mode switch rebuilds the element's attributes; the attachment that moves focus away on
	// unmount must not run for it.
	it('keeps focus in the element across a switch to live mode', async () => {
		const editor = mountLeaf(view());
		await editor.settle();
		placeCaret(surfaceAt(editor, LEAF), 4);
		editor.props.presentationMode = 'live';
		await editor.settle();
		expect(document.activeElement).toBe(surfaceAt(editor, LEAF));
	});

	it('replaces a range with a paste, and its undo caret is where the paste began', async () => {
		const editor = mountLeaf(view());
		await editor.settle();
		const el = surfaceAt(editor, LEAF);
		placeCaret(el, 6);
		dispatchKey(el, { key: 'Shift' });
		selectRange(el, 4, 6);
		paste(el, 'Z');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'aZd'));
		expect(newestEntryCaret(editor)).toEqual({ path: LEAF, offset: 4 });
	});

	it('goes inert in reading mode and editable again after it', async () => {
		const editor = mountLeaf(view());
		await editor.settle();
		editor.props.presentationMode = 'reading';
		await editor.settle();
		expect(surfaceAt(editor, LEAF).getAttribute('contenteditable')).toBe('false');
		editor.props.presentationMode = 'source';
		await editor.settle();
		expect(surfaceAt(editor, LEAF).getAttribute('contenteditable')).toBe('true');
		expect(surfaceAt(editor, LEAF).getAttribute('role')).toBe('textbox');
	});

	it('draws the new document’s block after a source swap', async () => {
		const editor = mountLeaf(view());
		await editor.settle();
		const before = surfaceAt(editor, LEAF);
		editor.props.source = 'intro\n\n@@ other\n';
		await editor.settle();
		expect(surfaceAt(editor, LEAF).textContent).toBe('@@ other');
		expect(before.isConnected && before.textContent === '@@ abcd').toBe(false);
	});
});

describe('a DOM leaf view’s lifecycle', () => {
	it('mounts once, gets an update per change to its text, and is destroyed at teardown', async () => {
		const log = newViewLog();
		const editor = mountLeaf(domPlainLeaf(log));
		await editor.settle();
		expect(log.mounts).toHaveLength(1);
		expect(log.updates).toHaveLength(0);

		typeInto(surfaceAt(editor, LEAF), '@@ abcdX');
		await editor.settle();
		typeInto(surfaceAt(editor, LEAF), '@@ abcdXY');
		await editor.settle();
		expect(log.raws).toEqual(['@@ abcdX\n', '@@ abcdXY\n']);
		expect(log.updates[0].path).toEqual(LEAF);

		await editor.destroy();
		expect(log.destroys).toBe(1);
		expect(log.mounts).toHaveLength(1);
	});

	it('is mounted again into a fresh element when update returns false', async () => {
		const log = newViewLog();
		const editor = mountLeaf(
			domPlainLeaf(log, () => ({ update: (state) => !state.node.raw.includes('!') }))
		);
		await editor.settle();
		typeInto(surfaceAt(editor, LEAF), '@@ abcd!');
		await editor.settle();
		expect(log.mounts).toHaveLength(2);
		expect(log.destroys).toBe(1);
		expect(log.mounts[1]).not.toBe(log.mounts[0]);
		expect(log.mounts[0].isConnected).toBe(false);

		typeInto(surfaceAt(editor, LEAF), '@@ abcd!?');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcd!?'));
	});

	it('runs afterInput with the element’s text, and reports its throw while the edit lands', async () => {
		const seen: string[] = [];
		const editor = mountLeaf(
			domPlainLeaf(newViewLog(), () => ({
				afterInput(text: string) {
					seen.push(text);
					if (text.endsWith('!')) throw new Error('after input exploded');
				}
			}))
		);
		const errors: unknown[] = [];
		editor.instance.getEvents().on('error', (report) => errors.push(report));
		await editor.settle();
		typeInto(surfaceAt(editor, LEAF), '@@ abcd!');
		await editor.settle();
		expect(seen).toEqual(['@@ abcd!']);
		expect(errors).toHaveLength(1);
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcd!'));
	});

	// Miss-analysis: afterInput listened for `input`, and a delete the editor writes itself fires none.
	it('runs afterInput once for a Backspace the editor writes itself', async () => {
		const seen: string[] = [];
		const editor = mountLeaf(
			domPlainLeaf(newViewLog(), () => ({ afterInput: (text: string) => void seen.push(text) }))
		);
		await editor.settle();
		const el = surfaceAt(editor, LEAF);
		placeCaret(el, '@@ abcd'.length);
		el.dispatchEvent(
			new InputEvent('beforeinput', {
				inputType: 'deleteContentBackward',
				bubbles: true,
				cancelable: true
			})
		);
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abc'));
		expect(seen).toEqual(['@@ abc']);
	});

	it('fills the element the editor made, and the text element is the block’s content', async () => {
		const log = newViewLog();
		const editor = mountLeaf(domPlainLeaf(log));
		await editor.settle();
		const host = editor.target.querySelector<HTMLElement>(`[data-block-path="[1]"]`)!;
		expect(host.querySelector(BLOCK_CONTENT_SELECTOR)).toBe(log.mounts[0]);
		expect(log.mounts[0].tagName).toBe('DIV');
		expect(blockContentElAt(editor.target, LEAF)).toBe(surfaceAt(editor, LEAF));
	});

	// Chrome before the text: caret offsets and the editor's focus still go to the text element.
	describe('with a badge drawn before its text', () => {
		const badged = () =>
			defineBlockView({
				surface: 'leaf',
				mount(target, ctx) {
					const badge = document.createElement('span');
					badge.textContent = 'memo';
					const el = document.createElement('div');
					target.append(badge, el);
					ctx.leaf.attach(el);
					return {};
				}
			});

		it('puts a paste’s undo caret where the paste began', async () => {
			const editor = mountLeaf(badged());
			await editor.settle();
			const el = surfaceAt(editor, LEAF);
			placeCaret(el, 6);
			selectRange(el, 4, 6);
			paste(el, 'Z');
			await editor.settle();
			expect(editor.source()).toBe(SOURCE.replace('abcd', 'aZd'));
			expect(newestEntryCaret(editor)).toEqual({ path: LEAF, offset: 4 });
		});

		it('keeps focus in the text across a switch to live mode', async () => {
			const editor = mountLeaf(badged());
			await editor.settle();
			placeCaret(surfaceAt(editor, LEAF), 4);
			editor.props.presentationMode = 'live';
			await editor.settle();
			expect(document.activeElement).toBe(surfaceAt(editor, LEAF));
		});

		// Miss-analysis: the descent to the text element had rows for focus and offsets, none for a measure.
		it('measures the whole drawn block for rects.blockRect, badge included', async () => {
			const editor = mountLeaf(badged());
			await editor.settle();
			const text = surfaceAt(editor, LEAF);
			const target = text.parentElement!;
			target.getBoundingClientRect = () => new DOMRect(0, 10, 300, 40);
			text.getBoundingClientRect = () => new DOMRect(0, 30, 300, 20);
			expect(editor.instance.getRects().blockRect(LEAF)?.height).toBe(40);
		});
	});
});

describe('G1.136: a DOM leaf view’s element rules', () => {
	const leafWith = (build: (target: HTMLElement, el: HTMLElement) => void, attachFirst = true) =>
		defineBlockView({
			surface: 'leaf',
			mount(target, ctx) {
				const el = document.createElement('div');
				if (attachFirst) ctx.leaf.attach(el);
				build(target, el);
				if (!attachFirst) ctx.leaf.attach(el);
				return {};
			}
		});
	const dropWarns = () =>
		takeDevWarns()
			.map((w) => w.tag)
			.filter((tag) => tag === 'invariant:dom-view-content');

	it('is quiet for chrome on either side of the attached element', async () => {
		const editor = mountLeaf(
			leafWith((target, el) => {
				const before = document.createElement('span');
				before.textContent = 'memo';
				target.append(before, el, document.createElement('button'));
			})
		);
		await editor.settle();
		expect(dropWarns()).toEqual([]);
	});

	it.each([
		[
			'`display: contents` on the target',
			(target: HTMLElement, el: HTMLElement) => {
				target.style.display = 'contents';
				target.append(el);
			}
		],
		['an attached element outside the target', () => {}]
	])('warns for %s', async (_name, build) => {
		const editor = mountLeaf(leafWith(build));
		await editor.settle();
		expect(dropWarns().length).toBeGreaterThan(0);
	});

	it('warns when the attached element holds an element of its own', async () => {
		const editor = mountLeaf(
			leafWith((target, el) => {
				el.append(document.createElement('b'));
				target.append(el);
			}, false)
		);
		await editor.settle();
		expect(dropWarns().length).toBeGreaterThan(0);
	});
});
