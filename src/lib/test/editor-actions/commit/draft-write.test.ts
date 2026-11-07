// @vitest-environment jsdom
// A draft, the one write a plugin or a host makes: its byte ranges land as one undo step, past what
// the author typed meanwhile, or it's refused with the reason when a write touched one of them.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Document } from '#lib/core/nodes.js';
import type { EditorContext } from '#lib/schema/plugin-install.js';
import { definePlugin } from '#lib/schema/plugin-install.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

type Surface = { getDocument(): Document; getUndoStack(): { undo: unknown[] } };

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	expect(takeDevWarns()).toEqual([]);
});

async function mounted(source: string, presentationMode: PresentationMode = 'source') {
	const editor = mountEditor<Surface>({ source, presentationMode });
	await editor.settle();
	return editor;
}

/** A keystroke as the browser leaves it: the block's new text, the caret after what was typed. */
async function typeAt(editor: MountedEditor<Surface>, path: number[], text: string, caret: number) {
	const el = surfaceAt(editor, path);
	el.textContent = text;
	placeCaret(el, caret);
	el.dispatchEvent(new InputEvent('input', { bubbles: true }));
	await editor.settle();
}

async function undo(editor: MountedEditor<Surface>) {
	editor.instance.runCommand('history.undo');
	await editor.settle();
	return editor.source();
}

const CARD = '[card]';

describe('a draft', () => {
	it('writes two far-apart ranges as one undo step, the block between left alone', async () => {
		let context: EditorContext | null = null;
		const writer = definePlugin({
			name: 'unit-draft-writer',
			setup: (ctx) => ctx.onEditor((editor) => void (context = editor))
		});
		const editor = mountEditor<Surface>({ source: 'one\n\ntwo\n\nthree\n', plugins: [writer] });
		await editor.settle();
		const between = editor.instance.__test.getDocument().children[1];

		const draft = context!.edit().replace({ from: 0, to: 3 }, 'ONE');
		const result = await draft.replace({ from: 10, to: 15 }, 'THREE').commit();
		await editor.settle();

		expect(result).toEqual({ ok: true });
		expect(editor.source()).toBe('ONE\n\ntwo\n\nTHREE\n');
		expect(editor.instance.__test.getDocument().children[1]).toBe(between);
		expect(editor.instance.__test.getUndoStack().undo).toHaveLength(1);
		expect(await undo(editor)).toBe('one\n\ntwo\n\nthree\n');
	});

	it('lands past typing elsewhere in its paragraph, before its range and after it', async () => {
		const editor = await mounted('Say @que here\n');
		const draft = editor.instance.edit();
		await typeAt(editor, [0], 'XSay @que here', 1);
		await typeAt(editor, [0], 'XSay @que hereY', 15);

		const result = await draft.replace({ from: 4, to: 8 }, CARD).commit();

		expect(result).toEqual({ ok: true });
		expect(editor.source()).toBe(`XSay ${CARD} hereY\n`);
	});

	it('goes stale while it waits once typing lands inside its range, and is refused', async () => {
		const editor = await mounted('Say @que here\n');
		const draft = editor.instance.edit().replace({ from: 4, to: 8 }, CARD);
		await typeAt(editor, [0], 'Say @quX here', 7);

		expect(draft.stale).toBe(true);
		expect(await draft.commit()).toMatchObject({ ok: false, reason: 'moved' });
		expect(editor.source()).toBe('Say @quX here\n');
	});

	// Miss-analysis: every waiting-draft row typed a letter unlike its neighbours, where a diff can't
	// tell typing inside a range's last letters from typing just past them.
	describe('with a letter typed beside the same letter', () => {
		const LEAF = 'Say @que here';
		// The draft holds `@que`, the leaf's bytes 4 to 8; a letter typed at 4 or at 8 is outside it.
		const twins = [3, 4, 5, 7, 8, 9].flatMap((at) =>
			[...new Set([LEAF[at - 1], LEAF[at]])].map((letter) => ({ at, letter }))
		);
		const cases = ['top-level', 'quoted'].flatMap((where) => twins.map((t) => ({ where, ...t })));

		it.each(cases)('in a $where paragraph, $letter at $at lands as typed or refuses', async (c) => {
			const marker = c.where === 'quoted' ? '> ' : '';
			const editor = await mounted(`${marker}${LEAF}\n`);
			const draft = editor.instance
				.edit()
				.replace({ from: marker.length + 4, to: marker.length + 8 }, CARD);
			const typed = LEAF.slice(0, c.at) + c.letter + LEAF.slice(c.at);
			await typeAt(editor, marker ? [0, 0] : [0], typed, c.at + 1);

			const result = await draft.commit();
			const inside = c.at > 4 && c.at < 8;
			const before = c.at <= 4 ? 5 : 4;
			if (result.ok) {
				expect(editor.source()).toBe(
					`${marker}${typed.slice(0, before)}${CARD}${typed.slice(before + 4)}\n`
				);
			} else expect(result).toMatchObject({ reason: 'moved' });
			// A top-level keystroke says where it typed; in a container only typing inside must refuse.
			if (inside || !marker) expect(result.ok).toBe(!inside);
		});
	});

	it('lands past a letter typed after its range in a quote', async () => {
		const editor = await mounted('> Say @que here\n');
		const draft = editor.instance.edit().replace({ from: 6, to: 10 }, CARD);
		await typeAt(editor, [0, 0], 'Say @quex here', 9);
		expect(await draft.commit()).toEqual({ ok: true });
		expect(editor.source()).toBe(`> Say ${CARD}x here\n`);
	});

	it('gives a query, typing elsewhere, and the card that lands last three undo steps', async () => {
		const editor = await mounted('Say\n\nNotes\n');
		await typeAt(editor, [0], 'Say @que', 8);
		const pick = editor.instance.edit();
		await typeAt(editor, [1], 'Notes ab', 8);

		expect(await pick.replace({ from: 4, to: 8 }, CARD).commit()).toEqual({ ok: true });
		await editor.settle();

		expect(editor.source()).toBe(`Say ${CARD}\n\nNotes ab\n`);
		expect(await undo(editor)).toBe('Say @que\n\nNotes ab\n');
		expect(await undo(editor)).toBe('Say @que\n\nNotes\n');
		expect(await undo(editor)).toBe('Say\n\nNotes\n');
	});

	it('leaves the author caret where it was when it writes elsewhere', async () => {
		const editor = await mounted('one\n\ntwo\n');
		placeCaret(surfaceAt(editor, [1]), 2);
		const before = editor.instance.getSelection();

		expect(await editor.instance.edit().replace({ from: 0, to: 3 }, 'ONE!').commit()).toEqual({
			ok: true
		});
		await editor.settle();

		expect(editor.instance.getSelection()).toEqual(before);
	});
});

describe('a draft refused', () => {
	const refusals: [
		string,
		string,
		(editor: MountedEditor<Surface>) => Promise<unknown>,
		string?
	][] = [
		[
			'unloaded',
			'one\n',
			async (editor) => {
				const draft = editor.instance.edit().replace({ from: 0, to: 3 }, 'ONE');
				editor.props.source = 'another\n';
				await editor.settle();
				return draft.commit();
			}
		],
		[
			'reading',
			'one\n',
			(editor) => editor.instance.edit().replace({ from: 0, to: 3 }, 'ONE').commit(),
			'reading'
		],
		[
			'overlap',
			'one two\n',
			(editor) =>
				editor.instance
					.edit()
					.replace({ from: 0, to: 5 }, 'x')
					.replace({ from: 4, to: 7 }, 'y')
					.commit()
		],
		[
			'illegal',
			'one\n',
			(editor) => editor.instance.edit().replace({ from: 0, to: 99 }, 'x').commit()
		],
		[
			'illegal',
			'one\r\ntwo\r\n',
			(editor) => editor.instance.edit().replace({ from: 4, to: 4 }, 'x').commit()
		],
		['empty', 'one\n', (editor) => editor.instance.edit().commit()],
		[
			'empty',
			'one\n',
			(editor) => editor.instance.edit().replace({ from: 0, to: 3 }, 'one').commit()
		],
		[
			'empty',
			'one\n',
			(editor) => {
				const draft = editor.instance.edit().replace({ from: 0, to: 3 }, 'ONE');
				draft.end();
				return draft.commit();
			}
		]
	];

	it.each(refusals)('as %s, writing nothing, over %j', async (reason, source, run, mode) => {
		const editor = await mounted(source, (mode as PresentationMode) ?? 'source');
		const before = editor.source();
		expect(await run(editor)).toMatchObject({ ok: false, reason });
		await editor.settle();
		if (reason !== 'unloaded') expect(editor.source()).toBe(before);
	});
});
