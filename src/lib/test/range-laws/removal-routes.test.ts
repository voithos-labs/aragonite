// @vitest-environment jsdom
// G1.199: every route that removes a range leaves the range-edit core's bytes, a cut writes the
// core's copy of the range it took, and one undo gives the source back.
// Miss-analysis: the copy and the delete each had suites of their own, and none ran every removal
// route over one range against the answer they all share.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { cellPoint, type EditorSelection } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { documentBytes, wholeBlockBytes } from '#lib/selection/range-bytes.js';
import { wholeBlocksRemovalOf } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { rangeClipboard } from '#lib/selection/range-clipboard.js';
import type { RemovalGesture } from '#lib/selection/caret-target.js';
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
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { deleteRange } from '#lib/test/harness/range-delete.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	CLIPBOARD_ROUTES,
	clipboardGesture,
	mountCase,
	placeRange,
	runHistory,
	Undetermined,
	type Editor
} from './gestures';

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

interface Shape {
	source: string;
	select: EditorSelection;
}

const at = (path: number[], offset: number) => ({ path, offset });
const range = (anchor: Shape['select']['anchor'], focus: Shape['select']['focus']) => ({
	anchor,
	focus
});

/** The shapes each removal once parted on: a copy and a delete that disagreed, a fence a range
 *  enters or leaves, a title row, a list the range joins into. */
const SHAPES: Record<string, Shape> = {
	'two paragraphs': {
		source: 'alpha bravo\n\ncharlie delta\n',
		select: range(at([0], 6), at([1], 8))
	},
	'out of a table': {
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n',
		select: range(cellPoint([0], 2), at([1], 3))
	},
	'from a title row out': {
		source: '<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n\nAAAA\n',
		select: range(at([0, 0], 1), at([1], 2))
	},
	'onto a title row': {
		source: 'MMMM\n\n<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n',
		select: range(at([0], 1), at([1, 0], 0))
	},
	'through a heading': { source: 'a\n# h\nb\n', select: range(at([0], 0), at([1], 3)) },
	'a quote into a nested list': {
		source: '> word\n1. n\n> - x\n\n-\t- x\n',
		select: range(at([0, 0], 0), at([2, 0, 0, 0], 1))
	},
	'back onto a callout title': {
		source: ':::callout Title\na\n:::\n',
		select: range(at([0, 1], 1), at([0, 0], 0))
	},
	'back into a code block': { source: '```\nx\n```\nb\n', select: range(at([1], 1), at([0], 5)) },
	'out of a math block past its closer': {
		source: '$$\nx\n$$\n\nbb\n',
		select: range(at([0], 4), at([1], 1))
	},
	'out of a code block past its closer': {
		source: '```\nx\n```\n\nbb\n',
		select: range(at([0], 5), at([1], 1))
	},
	'from a list item into the item a math block opens': {
		source: '- a\n- b\n\n  $$\n  y\n  $$\n',
		select: range(at([0, 0, 0], 0), at([0, 1, 0], 1))
	},
	'across ordered items, which number on': {
		source: '1. one\n2. two\n3. three\n',
		select: range(at([0, 0, 0], 1), at([0, 1, 0], 1))
	},
	'out of a format run': {
		source: '**bold text**\n\nafter\n',
		select: range(at([0], 4), at([1], 2))
	}
};

type Route =
	{ key: 'Backspace' | 'Delete'; ctrl: boolean } | { cut: (typeof CLIPBOARD_ROUTES)[number] };

const ROUTES: Record<string, Route> = {
	Backspace: { key: 'Backspace', ctrl: false },
	Delete: { key: 'Delete', ctrl: false },
	'Ctrl+Backspace': { key: 'Backspace', ctrl: true },
	'Ctrl+Delete': { key: 'Delete', ctrl: true },
	...Object.fromEntries(CLIPBOARD_ROUTES.map((r) => [`cut by ${r}`, { cut: r }]))
};

/** The core's answer for the range the editor holds: its bytes and, for a cut, its copy. */
function coreAnswer(editor: Editor, mode: PresentationMode, gesture: RemovalGesture) {
	const grammar = editor.instance.__test.getGrammar();
	const reading = fixtureReading({ grammar }, mode);
	const doc = readAsOpened(editor.source(), { grammar, scope: 'document' }) as Document;
	const held = editor.instance.getSelection()!;
	const selection = createSelectionState({ getDoc: () => doc });
	selection.enterCrossBlock(held.anchor, held.focus);
	const { start, end } = selection;
	const coverage = rangeCoverage(doc, coverRange(doc, start!, end!));
	const bytes = documentBytes({ version: () => 0, doc: () => doc, source: () => serialize(doc) });
	const copy = rangeClipboard(bytes, coverage, reading)?.text ?? '';
	deleteRange(doc, start!, end!, { reading, gesture });
	return { source: serialize(doc), copy };
}

async function drive(editor: Editor, route: Route): Promise<string | null> {
	if ('cut' in route) return (await clipboardGesture(editor, 'cut', route.cut))['text/plain'] ?? '';
	const el = (document.activeElement as HTMLElement | null) ?? document.body;
	const took = await pressHardwareKey(el, { key: route.key, ctrlKey: route.ctrl });
	await editor.settle();
	return took === 'browser' ? null : '';
}

describe('every removal route leaves the core’s bytes', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const [shape, { source, select }] of Object.entries(SHAPES)) {
			it.each(Object.entries(ROUTES))(`${mode}, ${shape}: %s`, async (_, route) => {
				const editor = mountCase(source, mode);
				await editor.settle();
				expect(await placeRange(editor, select), 'the range would not place').toBe(true);
				const gesture: RemovalGesture = 'cut' in route ? 'cut' : route.key;
				const want = coreAnswer(editor, mode, gesture);
				let wrote: string | null;
				try {
					wrote = await drive(editor, route);
				} catch (e) {
					if (e instanceof Undetermined) return;
					throw e;
				}
				expect(wrote, 'the browser would have handled the key').not.toBeNull();
				expect(editor.source()).toBe(want.source);
				if ('cut' in route) expect(wrote).toBe(want.copy);
				await runHistory(editor, 'undo');
				expect(editor.source(), 'one undo').toBe(source);
			});
		}
	}
});

// ── A block removed whole ────────────────────────────────────────────────────

/** The blocks each whole-block route removes: a rule a focused block's keys reach, top-level, in a
 *  quote and as the last block, and blocks only the menu offers its Delete on. */
const WHOLE: Record<string, { source: string; path: number[]; keys: boolean; menu: boolean }> = {
	'a rule between paragraphs': { source: 'a\n\n---\n\nb\n', path: [1], keys: true, menu: true },
	'a rule in a quote': { source: '> a\n>\n> ---\n>\n> b\n', path: [0, 1], keys: true, menu: false },
	'a rule ending the document': { source: 'a\n\n---', path: [1], keys: true, menu: true },
	'a code block': { source: 'a\n\n```\nx\n```\n\nb\n', path: [1], keys: false, menu: true },
	'a rule in an ordered list item': {
		source: '1. one\n\n   ---\n\n   two\n2. three\n',
		path: [0, 0, 1],
		keys: true,
		menu: false
	}
};

type WholeRoute = { key: 'Backspace' | 'Delete' } | { cut: true } | { menu: true };

const WHOLE_ROUTES: Record<string, WholeRoute> = {
	'Backspace on the block focused whole': { key: 'Backspace' },
	'Delete on the block focused whole': { key: 'Delete' },
	'Mod+X on the block focused whole': { cut: true },
	'the block menu’s Remove': { menu: true }
};

/** The core's answer for the block at `path` removed whole. */
function wholeAnswer(editor: Editor, mode: PresentationMode, path: number[]) {
	const grammar = editor.instance.__test.getGrammar();
	const reading = fixtureReading({ grammar }, mode);
	const source = editor.source();
	const doc = readAsOpened(source, { grammar, scope: 'document' }) as Document;
	const layout = documentLayout(doc);
	const range = wholeBlockBytes(doc, layout, path)!;
	const host = rangeHost(reading, { source, tree: doc, layout });
	const core = mode === 'live' ? 'live' : 'source';
	return wholeBlocksRemovalOf(source, range, core, host);
}

async function driveWhole(editor: Editor, path: number[], route: WholeRoute): Promise<boolean> {
	editor.instance.__test.getBlockComponent(path)!.focus(0);
	await editor.settle();
	const el = document.activeElement as HTMLElement;
	if ('menu' in route) {
		el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await editor.settle();
		const row = [
			...document.querySelectorAll<HTMLButtonElement>('.md-menu [role="menuitem"]')
		].find((r) => r.textContent?.trim().startsWith('Remove'));
		row?.click();
		await editor.settle();
		return row !== undefined;
	}
	const init = 'cut' in route ? { key: 'x', ctrlKey: true } : { key: route.key };
	const took = await pressHardwareKey(el, init);
	await editor.settle();
	await editor.settle();
	return took !== 'browser';
}

describe('every whole-block route leaves the core’s bytes', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const [shape, { source, path, keys, menu }] of Object.entries(WHOLE)) {
			const routes = Object.entries(WHOLE_ROUTES).filter(([, r]) => ('menu' in r ? menu : keys));
			it.each(routes)(`${mode}, ${shape}: %s`, async (_, route) => {
				const editor = mountCase(source, mode);
				await editor.settle();
				const want = wholeAnswer(editor, mode, path);
				expect(await driveWhole(editor, path, route), 'the route took no action').toBe(true);
				expect(editor.source()).toBe(want);
				await runHistory(editor, 'undo');
				expect(editor.source(), 'one undo').toBe(source);
			});
		}
	}
});
