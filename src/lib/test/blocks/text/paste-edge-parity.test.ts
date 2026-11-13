// @vitest-environment jsdom
// A paste lands on the side of a hidden edge a typed letter takes, by every paste route, when what
// it brings holds syntax the screen shows less of than its bytes; the syntax characters typed at
// those edges land where they always have.
// Miss-analysis: every edge row pasted plain letters, which show their own bytes, so no row pasted
// a clipboard that shows less on screen than it holds.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { TEXT_HOSTS, insertBy } from '#lib/test/harness/insertion-routes.js';
import { insertsAt } from '#lib/caret/next-insertion.js';
import {
	PASTE_ROUTES,
	mountCase,
	pasteGesture,
	pastePlainGesture,
	shiftPaste,
	type Editor
} from '../../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(destroyMountedEditors);

type Host = (typeof TEXT_HOSTS)[number];

/** A live line and the caret's raw offset at a hidden edge in it, inside the construct's bytes. */
const EDGES = [
	{ name: "an autolink's closer", line: 'a <http://x.y> z', caret: 13 },
	{ name: "a link's closer", line: 'a [lk](u) z', caret: 5 },
	{ name: "a bold run's closer", line: 'a **bo** z', caret: 6 },
	{ name: "an escape's backslash", line: 'a \\*b z', caret: 2 }
];

function arrive(host: Host, edge: (typeof EDGES)[number]): Editor {
	const editor = mountCase(host.source(edge.line), 'live');
	placeCaret(host.el(editor), edge.caret);
	return editor;
}

const ROUTES = [...PASTE_ROUTES, 'plain menu', 'shift key'] as const;
type Route = (typeof ROUTES)[number];
const CLIPS = ['**q**', '\\*', '`c`', '1. one'];

async function pasteBy(editor: Editor, route: Route, clip: string) {
	if (route === 'plain menu') return pastePlainGesture(editor, clip);
	if (route === 'shift key') return shiftPaste(editor, clip);
	return pasteGesture(editor, { 'text/plain': clip }, route);
}

/** jsdom opens no menu over a cell, and a list pasted into a cell slices the table there. */
const drivenIn = (host: Host, route: Route, clip: string) =>
	host !== TEXT_HOSTS[1] ||
	(!route.includes('menu') && (clip !== '1. one' || route === 'shift key'));

describe.each(TEXT_HOSTS)('in $name', (host) => {
	describe.each(EDGES.slice(0, 2))('a paste holding syntax at $name', (edge) => {
		let letterAt: number;
		beforeAll(async () => {
			const editor = arrive(host, edge);
			await insertBy('hardware key', host.el(editor), 'X');
			letterAt = host.line(editor.source()).indexOf('X');
			await destroyMountedEditors();
		});

		const cases = ROUTES.flatMap((route) => CLIPS.map((clip) => [route, clip] as const));
		it.each(cases.filter(([route, clip]) => drivenIn(host, route, clip)))(
			'by %s, %s lands where a letter does',
			async (route, clip) => {
				const editor = arrive(host, edge);

				await pasteBy(editor, route, clip);

				const line = host.line(editor.source());
				expect(line).not.toBe(edge.line);
				expect(insertsAt(edge.line, line, letterAt), line).toBe(true);
			}
		);
	});
});

describe('a syntax character typed at a hidden edge', () => {
	const typed: [string, string, string][] = [
		["an autolink's closer", '*', 'a <http://x.y>** z\n'],
		["an autolink's closer", '_', 'a <http://x.y>__ z\n'],
		["an autolink's closer", '`', 'a <http://x.y>`` z\n'],
		["an autolink's closer", '\\', 'a <http://x.y>\\ z\n'],
		["an autolink's closer", '<', 'a <http://x.y>< z\n'],
		["a link's closer", '*', 'a [lk](u)** z\n'],
		["a link's closer", '_', 'a [lk](u)__ z\n'],
		["a link's closer", '`', 'a [lk](u)`` z\n'],
		["a link's closer", '\\', 'a [lk](u)\\ z\n'],
		["a link's closer", '<', 'a [lk](u)< z\n'],
		["a bold run's closer", '*', 'a **bo** z\n'],
		["a bold run's closer", '_', 'a **bo_** z\n'],
		["a bold run's closer", '`', 'a **bo``** z\n'],
		["a bold run's closer", '\\', 'a **bo**\\ z\n'],
		["a bold run's closer", '<', 'a **bo<** z\n'],
		["an escape's backslash", '*', 'a **\\*b z\n'],
		["an escape's backslash", '_', 'a __\\*b z\n'],
		["an escape's backslash", '`', 'a ``\\*b z\n'],
		["an escape's backslash", '\\', 'a \\\\*b z\n'],
		["an escape's backslash", '<', 'a <\\*b z\n']
	];
	it.each(typed)('at %s, %s gives %j', async (name, ch, want) => {
		const [host] = TEXT_HOSTS;
		const editor = arrive(
			host,
			EDGES.find((each) => each.name === name)!
		);

		await insertBy('hardware key', host.el(editor), ch);

		expect(editor.source()).toBe(want);
	});
});
