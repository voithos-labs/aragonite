// @vitest-environment jsdom
// A removal whose place is a boundary no arrow stops at holds the gap caret there, and a letter then
// leaves what the same letter typed over the range leaves; where a paragraph's own text takes the
// letter, the caret goes to that text. Then what each next key does at a gap held so.
// Miss-analysis: the landing rows drew only boundaries an arrow stops at or text beside them, so a
// caret put on a fence line, a title row's name or a heading's end had no row to red.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { cellPoint, type EditorSelection } from '#lib/selection/primitives.js';
import type { GapCaretPosition } from '#lib/selection/gap-caret.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	blocksIn,
	clipboardGesture,
	kitFixtures,
	mountCase,
	pasteGesture,
	placeOwnedRange,
	runHistory,
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

type Route = 'Backspace' | 'Delete' | 'Mod+X' | 'a letter';
const ROUTES: Route[] = ['Backspace', 'Delete', 'Mod+X', 'a letter'];
const MODES: PresentationMode[] = ['source', 'live'];

type Take = EditorSelection | { whole: number[] };

interface Row {
	source: string;
	take: Take;
	/** The routes whose place is the boundary; every route where absent. */
	routes?: Route[];
	/** The gap the removal leaves the caret in; null where it goes to the text beside. */
	gap: GapCaretPosition | null;
	/** The document once the letter is in, blank lines aside. */
	typed: string;
}

const at = (path: number[], offset: number) => ({ path, offset });
const over = (path: number[], from: number, to: number): EditorSelection => ({
	anchor: at(path, from),
	focus: at(path, to)
});
const heldAt = (parentPath: number[], index: number): GapCaretPosition => ({
	parentPath,
	index,
	held: true
});

const CLOSED = '<details>\n<summary>S</summary>\n\nbody\n\n</details>\n';
const FENCE = '```\nx\n```\n';
const HEAD = '| H0 | H1 | H2 |\n| --- | --- | --- |\n';
const DEFINITION = '[my ref]: <https://x.com> "Title"';

const ROWS: Record<string, Row> = {
	'the last paragraph, tight under a fence': {
		source: `${FENCE}last\n`,
		take: over([1], 0, 4),
		gap: heldAt([], 1),
		typed: `${FENCE}\nq\n`
	},
	'the last paragraph, tight under a closed details': {
		source: `${CLOSED}last\n`,
		take: over([1], 0, 4),
		gap: heldAt([], 1),
		typed: `${CLOSED}\nq\n`
	},
	'a line under a heading in a quote': {
		source: '> # head\n> lazy\n',
		take: over([0, 1], 0, 4),
		gap: heldAt([0], 1),
		typed: '> # head\n>\n> q\n'
	},
	'a paragraph’s own last line in a quote': {
		source: '> a\n> b\n',
		take: over([0, 0], 2, 3),
		gap: null,
		typed: '> aq\n'
	},
	'an untitled directive cut down to its title row': {
		source: `:::note\n${FENCE}:::\n\nafter\n`,
		take: { anchor: at([0, 0], 7), focus: at([0, 1], 9) },
		routes: ['Mod+X', 'a letter'],
		gap: heldAt([0], 1),
		typed: ':::note\nq\n:::\n\nafter\n'
	},
	'a titled directive cut down to its title row': {
		source: `:::note Title\n${FENCE}:::\n\nafter\n`,
		take: { anchor: at([0, 0], 13), focus: at([0, 1], 9) },
		routes: ['Mod+X', 'a letter'],
		gap: heldAt([0], 1),
		typed: ':::note Title\nq\n:::\n\nafter\n'
	},
	// Miss-analysis: with no gap held there, the letter's paragraph was opened where the range
	// started, among the table's rows, which threw and dropped the letter; no row drew this shape.
	'a table’s body rows, down to a link definition below': {
		source: `${HEAD}|  |  |  |\n| x | y | x | y | x | y |\n\t\n \n${DEFINITION}`,
		take: { anchor: cellPoint([0], 5), focus: at([1], 1) },
		routes: ['Mod+X', 'a letter'],
		gap: heldAt([], 1),
		typed: `${HEAD}\nq\n\n${DEFINITION}`
	},
	'a rule cut between a paragraph and a fence': {
		source: `above\n\n---\n\n${FENCE}`,
		take: { whole: [1] },
		routes: ['Mod+X'],
		gap: heldAt([], 1),
		typed: `above\n\nq\n\n${FENCE}`
	}
};

async function key(editor: Editor, name: string, init: KeyboardEventInit = {}): Promise<void> {
	const el = (document.activeElement as HTMLElement | null) ?? document.body;
	await pressHardwareKey(el, { key: name, ...init });
	await editor.settle();
}

/** Takes what `take` names by `route`; the letter route types `q` over it. */
async function remove(editor: Editor, take: Take, route: Route): Promise<void> {
	if ('whole' in take) {
		editor.instance.__test.getBlockComponent(take.whole)!.focus(0);
		await editor.settle();
	} else {
		expect(await placeOwnedRange(editor, take), 'the range would not place').toBe(true);
	}
	if (route === 'Mod+X' && !('whole' in take)) await clipboardGesture(editor, 'cut', 'key');
	else if (route === 'Mod+X') await key(editor, 'x', { ctrlKey: true });
	else await key(editor, route === 'a letter' ? 'q' : route);
	await editor.settle();
}

/** The gap caret as a person meets it: the bar's element drawn once, its proxy holding focus. */
function expectGapShown(editor: Editor, gap: GapCaretPosition): void {
	expect(editor.instance.__test.getGapCaret(), 'the gap caret').toStrictEqual(gap);
	const drawn = document.querySelectorAll('[data-gap-caret]');
	expect(drawn, 'the gap caret drawn').toHaveLength(1);
	expect(document.activeElement?.parentElement, 'focus on its proxy').toBe(drawn[0]);
}

async function blocksOfSource(source: string, mode: PresentationMode): Promise<unknown[]> {
	const fresh = mountCase(source, mode);
	await fresh.settle();
	return blocksIn(fresh);
}

describe('a boundary no arrow stops at holds the caret, unless a letter there joins prose', () => {
	const cases = MODES.flatMap((mode) =>
		Object.entries(ROWS).flatMap(([name, row]) =>
			(row.routes ?? ROUTES).map((route) => ({ mode, name, route, row }))
		)
	);
	it.each(cases)('$mode, $name: $route', async ({ mode, route, row }) => {
		const editor = mountCase(row.source, mode);
		await editor.settle();
		await remove(editor, row.take, route);
		if (route !== 'a letter') {
			if (row.gap) expectGapShown(editor, row.gap);
			else expect(editor.instance.__test.getGapCaret(), 'the gap caret').toBeNull();
			await key(editor, 'q');
		}
		const typed = blocksIn(editor);
		expect(typed, editor.source()).toEqual(await blocksOfSource(row.typed, mode));
	});

	const kitCases = MODES.flatMap((mode) => ROUTES.map((route) => ({ mode, route })));
	it.each(kitCases)(
		'$mode, the last paragraph tight under every kit kind: $route',
		async ({ mode, route }) => {
			const out: string[] = [];
			const tried: string[] = [];
			for (const [kind, fixture] of await kitFixtures()) {
				await destroyMountedEditors();
				const block = fixture.replace(/\r?\n$/, '');
				const editor = mountCase(`${block}\nlast\n`, mode);
				await editor.settle();
				const tops = editor.instance.__test.getDocument().children;
				// A kind whose next line is its own (a paragraph, a quote, a table) has no such shape.
				if (tops.at(-1)?.raw !== 'last\n' || tops.at(-1)?.kind !== 'paragraph') continue;
				tried.push(kind);
				const last = tops.length - 1;
				await remove(editor, over([last], 0, 4), route);
				if (route !== 'a letter') {
					const gap = JSON.stringify(editor.instance.__test.getGapCaret());
					if (gap !== JSON.stringify(heldAt([], last))) out.push(`${kind}: the caret is ${gap}`);
					await key(editor, 'q');
				}
				const typed = JSON.stringify(blocksIn(editor));
				const want = JSON.stringify(await blocksOfSource(`${block}\n\nq\n`, mode));
				if (typed !== want) out.push(`${kind}: ${editor.source()}`);
			}
			expect(out).toEqual([]);
			expect(tried).toEqual(expect.arrayContaining(['fencedCode', 'heading', 'thematicBreak']));
		}
	);
});

// ── A command key over the range ─────────────────────────────────────────────

const END = ROWS['the last paragraph, tight under a fence'];

const OVER: Record<string, Pick<Row, 'source' | 'take' | 'gap'>> = {
	'the last paragraph, tight under a fence': END,
	'the last two paragraphs under a fence': {
		source: `intro\n\n${FENCE}last\n\nend\n`,
		take: { anchor: at([2], 0), focus: at([3], 3) },
		gap: heldAt([], 2)
	},
	'a line under a heading in a quote': ROWS['a line under a heading in a quote'],
	// A gap an arrow stops at too: the same key, the same answer.
	'a paragraph tight between two fences': {
		source: `${FENCE}para\n${FENCE}`,
		take: over([1], 0, 4),
		gap: { parentPath: [], index: 1 }
	}
};

const COMMAND_KEYS: Record<string, KeyboardEventInit> = {
	Enter: {},
	'Shift+Enter': { shiftKey: true }
};

// Miss-analysis: every row pressed a removal key or a letter over its range and none a command
// key, which then ran in the block at the gap's byte, a block that held no caret.
describe('a command key over a range that leaves the caret in a gap', () => {
	const reads = (editor: Editor) => ({
		source: editor.source(),
		caret: editor.instance.getSelection(),
		gap: editor.instance.__test.getGapCaret()
	});
	const cases = MODES.flatMap((mode) =>
		Object.entries(OVER).flatMap(([name, row]) =>
			Object.entries(COMMAND_KEYS).map(([chord, init]) => ({ mode, name, chord, init, row }))
		)
	);
	it.each(cases)(
		'$mode, $name: $chord is the removal, then $chord at the gap',
		async ({ mode, init, row }) => {
			const stepwise = mountCase(row.source, mode);
			await stepwise.settle();
			await remove(stepwise, row.take, 'Backspace');
			expectGapShown(stepwise, row.gap!);
			await key(stepwise, 'Enter', init);
			const want = reads(stepwise);
			expect(
				want.caret,
				'Enter at the gap opens a paragraph and puts the caret in it'
			).not.toBeNull();

			await destroyMountedEditors();
			const over = mountCase(row.source, mode);
			await over.settle();
			expect(await placeOwnedRange(over, row.take as EditorSelection)).toBe(true);
			await key(over, 'Enter', init);
			expect(reads(over)).toEqual(want);
		}
	);

	it.each(MODES)('%s: one undo takes Enter over the range back, range and all', async (mode) => {
		const row = OVER['the last two paragraphs under a fence'];
		const editor = mountCase(row.source, mode);
		await editor.settle();
		expect(await placeOwnedRange(editor, row.take as EditorSelection)).toBe(true);
		await key(editor, 'Enter');
		await runHistory(editor, 'undo');
		expect(editor.source()).toBe(row.source);
		expect(editor.instance.getSelection()).toEqual(row.take);
	});

	it.each(MODES)(
		'%s: an IME composition over the range opens its paragraph there',
		async (mode) => {
			const editor = mountCase(END.source, mode);
			await editor.settle();
			expect(await placeOwnedRange(editor, END.take as EditorSelection)).toBe(true);
			await insertBy('composition', document.activeElement as HTMLElement, '汉');
			await editor.settle();
			expect(blocksIn(editor), editor.source()).toEqual(
				await blocksOfSource(`${FENCE}\n汉\n`, mode)
			);
			expect(editor.instance.getSelection()).toEqual(caretAt([1], 1));
		}
	);
});

// ── What the next key does ───────────────────────────────────────────────────

const TITLE = ROWS['an untitled directive cut down to its title row'];
const caretAt = (path: number[], offset: number) => ({
	anchor: at(path, offset),
	focus: at(path, offset)
});

interface Next {
	/** The held gap the key is pressed at: the document's end, or under a directive's title row. */
	from: Row;
	run(editor: Editor): Promise<unknown>;
	/** The document after it, blank lines aside. */
	source: string;
	/** Where the caret is after it: the selection the editor reports, or the gap still held. */
	caret: EditorSelection | GapCaretPosition | null;
}

const AFTER_END = `${FENCE}\n`;
const AFTER_TITLE = ':::note\n:::\n\nafter\n';

const NEXT: Record<string, Next> = {
	'Escape leaves for the block above': {
		from: END,
		run: (e) => key(e, 'Escape'),
		source: AFTER_END,
		caret: caretAt([0], 5)
	},
	'ArrowUp leaves for the block above': {
		from: END,
		run: (e) => key(e, 'ArrowUp'),
		source: AFTER_END,
		caret: caretAt([0], 5)
	},
	'ArrowLeft leaves for the block above': {
		from: END,
		run: (e) => key(e, 'ArrowLeft'),
		source: AFTER_END,
		caret: caretAt([0], 5)
	},
	'Backspace leaves for the block above': {
		from: END,
		run: (e) => key(e, 'Backspace'),
		source: AFTER_END,
		caret: caretAt([0], 5)
	},
	'ArrowDown past the document’s end appends a paragraph, as from its last block': {
		from: END,
		run: (e) => key(e, 'ArrowDown'),
		source: AFTER_END,
		caret: caretAt([1], 0)
	},
	'ArrowRight past the document’s end appends a paragraph too': {
		from: END,
		run: (e) => key(e, 'ArrowRight'),
		source: AFTER_END,
		caret: caretAt([1], 0)
	},
	'Delete at the document’s end stays, writing nothing': {
		from: END,
		run: (e) => key(e, 'Delete'),
		source: AFTER_END,
		caret: heldAt([], 1)
	},
	'ArrowUp under a title row leaves for the row’s end': {
		from: TITLE,
		run: (e) => key(e, 'ArrowUp'),
		source: AFTER_TITLE,
		caret: caretAt([0, 0], 7)
	},
	'Escape under a title row leaves for the row’s end': {
		from: TITLE,
		run: (e) => key(e, 'Escape'),
		source: AFTER_TITLE,
		caret: caretAt([0, 0], 7)
	},
	'ArrowDown under a title row leaves the directive': {
		from: TITLE,
		run: (e) => key(e, 'ArrowDown'),
		source: AFTER_TITLE,
		caret: caretAt([1], 0)
	},
	'Delete under a title row leaves the directive': {
		from: TITLE,
		run: (e) => key(e, 'Delete'),
		source: AFTER_TITLE,
		caret: caretAt([1], 0)
	},
	'Enter opens an empty paragraph there': {
		from: TITLE,
		run: (e) => key(e, 'Enter'),
		source: AFTER_TITLE,
		caret: caretAt([0, 1], 0)
	},
	'an IME commit opens a paragraph holding the text': {
		from: END,
		run: async (e) => {
			await insertBy('composition', document.activeElement as HTMLElement, '汉');
			await e.settle();
		},
		source: `${FENCE}\n汉\n`,
		caret: caretAt([1], 1)
	},
	'a letter after a composition the browser dropped joins the composed text': {
		from: END,
		run: async (e) => {
			const proxy = document.activeElement as HTMLElement;
			proxy.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			proxy.textContent = 'か';
			await key(e, 'q');
			expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
		},
		source: `${FENCE}\nかq\n`,
		caret: caretAt([1], 2)
	},
	'a paste lands there as blocks': {
		from: TITLE,
		run: (e) => pasteGesture(e, { 'text/plain': '# pasted\n\ntext' }, 'key'),
		source: ':::note\n# pasted\n\ntext\n:::\n\nafter\n',
		caret: caretAt([0, 2], 4)
	},
	'an undo returns the removed range and its selection': {
		from: END,
		run: (e) => runHistory(e, 'undo'),
		source: END.source,
		caret: over([1], 0, 4)
	},
	'a redo returns the held gap': {
		from: END,
		run: async (e) => {
			await runHistory(e, 'undo');
			await runHistory(e, 'redo');
		},
		source: AFTER_END,
		caret: heldAt([], 1)
	},
	'undoing a letter typed there returns the held gap': {
		from: TITLE,
		run: async (e) => {
			await key(e, 'q');
			await runHistory(e, 'undo');
		},
		source: AFTER_TITLE,
		caret: heldAt([0], 1)
	},
	'a caret placed elsewhere ends it': {
		from: END,
		run: async (e) => {
			e.instance.__test.getBlockComponent([0])!.focus(4);
			await e.settle();
		},
		source: AFTER_END,
		caret: caretAt([0], 4)
	},
	'a switch between live and source keeps it': {
		from: END,
		run: async (e) => {
			e.props.presentationMode = e.props.presentationMode === 'live' ? 'source' : 'live';
			await e.settle();
		},
		source: AFTER_END,
		caret: heldAt([], 1)
	},
	'reading mode ends it': {
		from: END,
		run: async (e) => {
			e.props.presentationMode = 'reading';
			await e.settle();
		},
		source: AFTER_END,
		caret: null
	}
};

describe('at a gap a removal held, each next key does what it does at any gap', () => {
	const cases = MODES.flatMap((mode) =>
		Object.entries(NEXT).map(([name, next]) => ({ mode, name, next }))
	);
	it.each(cases)('$mode: $name', async ({ mode, next }) => {
		const editor = mountCase(next.from.source, mode);
		await editor.settle();
		await remove(editor, next.from.take, 'Mod+X');
		expectGapShown(editor, next.from.gap!);
		await next.run(editor);
		expect(blocksIn(editor), editor.source()).toEqual(await blocksOfSource(next.source, mode));
		if (next.caret && 'parentPath' in next.caret) return expectGapShown(editor, next.caret);
		expect(editor.instance.__test.getGapCaret(), 'the gap caret').toBeNull();
		expect(document.querySelectorAll('[data-gap-caret]'), 'the gap caret drawn').toHaveLength(0);
		expect(editor.instance.getSelection()).toEqual(next.caret);
	});

	// An arrow's gap ending the document's last container has nothing below it either.
	it.each(MODES)(
		'%s: Delete at a gap an arrow stops at, past the last block, stays too',
		async (mode) => {
			const source = `:::note\n${FENCE}:::\n`;
			const editor = mountCase(source, mode);
			await editor.settle();
			editor.instance.__test.getBlockComponent([0, 1])!.focus(5);
			await editor.settle();
			await key(editor, 'Delete');
			const gap = { parentPath: [0], index: 2 };
			expectGapShown(editor, gap);
			await key(editor, 'Delete');
			expectGapShown(editor, gap);
			expect(editor.source()).toBe(source);
		}
	);
});
