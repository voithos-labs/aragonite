// @vitest-environment jsdom
// A bullet's glyph names no list type: pasted items that join a list take its glyph, every bullet
// character against every other, at an item's end, mid-item, at its start and in an empty item, and
// an ordered list's delimiter the same way. Beside a list, at a paragraph's end over it or on the
// empty line under it, the pasted list joins it as items in its glyph too.
// Miss-analysis: the list rows pasted a list in the host's own glyph, so no row asked whether `* x`
// pasted into a `-` list joins it or parts it.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange, type PasteRoute } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted by `route` at `‸`, then `Z` typed: the bytes. */
async function typedAfter(marked: string, mode: PresentationMode, clip: string, route: PasteRoute) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, route);
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	return editor.source();
}

// [name, marked, clipboard, the bytes once `Z` is typed]
const ROWS: [string, string, string, string][] = [];
for (const host of ['-', '*', '+'])
	for (const glyph of ['-', '*', '+'].filter((g) => g !== host)) {
		const [h, clip] = [`${host} `, `${glyph} x\n${glyph} y\n`];
		ROWS.push(
			[
				`${glyph} into ${host}, at an item’s end`,
				`${h}a‸\n${h}b\n`,
				clip,
				`${h}ax\n${h}y\n${h}Z\n${h}b\n`
			],
			[
				`${glyph} into ${host}, mid-item`,
				`${h}a‸c\n${h}b\n`,
				clip,
				`${h}ax\n${h}y\n${h}Zc\n${h}b\n`
			],
			[
				`${glyph} into ${host}, at an item’s start`,
				`${h}‸a\n${h}b\n`,
				clip,
				`${h}x\n${h}y\n${h}Za\n${h}b\n`
			],
			[
				`${glyph} into ${host}, in an empty item`,
				`${h}a\n${h}‸\n${h}b\n`,
				clip,
				`${h}a\n${h}x\n${h}y\n${h}Z\n${h}b\n`
			]
		);
	}
for (const [host, glyph] of [
	[')', '.'],
	['.', ')']
])
	ROWS.push(
		[
			`1${glyph} into 1${host}, at an item’s end`,
			`1${host} a‸\n2${host} b\n`,
			`1${glyph} x\n2${glyph} y\n`,
			`1${host} ax\n2${host} y\n3${host} Z\n4${host} b\n`
		],
		[
			`1${glyph} into 1${host}, at an item’s start`,
			`1${host} ‸a\n2${host} b\n`,
			`1${glyph} x\n2${glyph} y\n`,
			`1${host} x\n2${host} y\n3${host} Za\n4${host} b\n`
		]
	);
ROWS.push(
	[
		'* over a - list under a paragraph',
		'abc‸\n- c\n',
		'* one\n* two\n',
		'abc\n\n- one\n- two\n- Z\n- c\n'
	],
	['* on the empty line under a - list', '- c\n\n‸\n', '* x\n* y\n', '- c\n- x\n- y\n- Z\n'],
	[
		'an ordered list breaks out of a bullet list still',
		'- a‸\n- b\n',
		'1. x\n2. y\n',
		'- a\n1. x\n2. y\n- Z\n- b\n'
	]
);

for (const [name, marked, clip, typed] of ROWS)
	for (const route of ['key', 'insertMarkdown'] as PasteRoute[])
		for (const mode of ['source', 'live'] as PresentationMode[])
			it(`${name}, ${route}, ${mode}`, async () => {
				expect(await typedAfter(marked, mode, clip, route)).toBe(typed);
			});
