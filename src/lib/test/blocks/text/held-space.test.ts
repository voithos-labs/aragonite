// @vitest-environment jsdom
// A space typed at a hidden closer is written past it while the caret still means inside: the next
// letter takes the space back in with it, on every route, and a move or a named side ends that.
// Miss-analysis: every edge row typed a letter, never whitespace, the one byte a closer can't
// follow, so nothing saw the space carry the caret out of the construct.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	mountWithCaret,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	INSERTION_ROUTES,
	TEXT_HOSTS,
	insertBy,
	type InsertionRoute
} from '#lib/test/harness/insertion-routes.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// A route bug breaks the hold for every delimiter, and a delimiter bug on every route, so bold
// takes each route and the other delimiters the hardware key.
const NEW_PAIRS: [delimiter: string, route: InsertionRoute][] = [
	...INSERTION_ROUTES.map((route): [string, InsertionRoute] => ['**', route]),
	['*', 'hardware key'],
	['_', 'hardware key'],
	['~~', 'hardware key']
];

describe.each(NEW_PAIRS)('a new %s pair', (delimiter, route) => {
	it(`keeps a space and the next letter inside, typed by ${route}`, async () => {
		const { editor, el } = mountWithCaret(`a ${delimiter}two${delimiter}\n`, 5 + delimiter.length);

		await insertBy(route, el, ' ');
		expect(editor.source()).toBe(`a ${delimiter}two${delimiter} \n`);
		await insertBy(route, el, 'w');

		expect(editor.source()).toBe(`a ${delimiter}two w${delimiter}\n`);
	});
});

describe.each(TEXT_HOSTS)('a held space in $name', (host) => {
	async function heldIn() {
		const editor = mountEditor({ source: host.source('a **two**'), presentationMode: 'live' });
		const el = host.el(editor);
		placeCaret(el, 7);
		await insertBy('hardware key', el, ' ');
		return { editor, el };
	}

	it('the next letter takes the space back in', async () => {
		const { editor, el } = await heldIn();
		// Past the closer, never inside it, where the bold would show its markers.
		expect(editor.source()).not.toContain('**two **');

		await insertBy('soft key', el, 'w');

		expect(host.line(editor.source())).toBe('a **two w**');
	});
});

describe('typing on after an existing bold', () => {
	it('a click at its end, then a space and a word, extends it', async () => {
		const { editor, el } = mountWithCaret('**bold**\n', 6);

		await insertBy('hardware key', el, ' more');

		expect(editor.source()).toBe('**bold more**\n');
	});

	// The space typed mid-line sits beside the line's own, so the run fits at two offsets.
	it('mid-line, a click at its end, then a space and a word, extends it', async () => {
		const { editor, el } = mountWithCaret('Some **bold** text\n', 11);

		await insertBy('hardware key', el, ' more');

		expect(editor.source()).toBe('Some **bold more** text\n');
	});

	it('a second space keeps the hold', async () => {
		const { editor, el } = mountWithCaret('a **two**\n', 7);

		await insertBy('hardware key', el, '  w');

		expect(editor.source()).toBe('a **two  w**\n');
	});

	it('the format chord before the space types outside', async () => {
		const { editor, el } = mountWithCaret('**bold**\n', 6);
		await pressKey(el, { key: 'b', ctrlKey: true });

		await insertBy('hardware key', el, ' more');

		expect(editor.source()).toBe('**bold** more\n');
	});
});

/** The ways out of a held space Finn asked for that move no caret: the closer, the format chord. */
const EXITS: [string, KeyboardEventInit][] = [
	['the typed closer', { key: '*' }],
	['the format chord', { key: 'b', ctrlKey: true }]
];

describe.each(EXITS)('%s ends the hold, and the next letter lands outside', (_name, exit) => {
	it('at the line’s end', async () => {
		const { editor, el } = mountWithCaret('a **two**\n', 7);
		await insertBy('hardware key', el, ' ');

		await (exit.key === '*' ? insertBy('hardware key', el, '*') : pressKey(el, exit));
		await insertBy('hardware key', el, 'w');

		expect(editor.source()).toBe('a **two** w\n');
	});

	it('mid-line', async () => {
		const { editor, el } = mountWithCaret('a **two** b\n', 7);
		await insertBy('hardware key', el, ' ');
		expect(editor.source()).toBe('a **two**  b\n');

		await (exit.key === '*' ? insertBy('hardware key', el, '*') : pressKey(el, exit));
		await insertBy('hardware key', el, 'w');

		expect(editor.source()).toBe('a **two** w b\n');
	});
});

// A closer typed whole across a held space steps past the whole closer run; the space stays put.
// Miss-analysis: the closer exit rows typed one byte of a two-byte closer, never the whole of it.
describe.each([
	['**', 'bold'],
	['~~', 'gone']
])('a held space, then the whole %s closer', (delimiter, word) => {
	it('types the next letter outside, past the space', async () => {
		const at = 2 + delimiter.length + word.length;
		const { editor, el } = mountWithCaret(
			`a ${delimiter}${word}${delimiter} b
`,
			at
		);
		await insertBy('hardware key', el, ' ');

		await insertBy('hardware key', el, `${delimiter}X`);

		expect(editor.source()).toBe(`a ${delimiter}${word}${delimiter} X b
`);
	});
});

// The held construct's own chord leaves it; another chord pends its mark, as at any caret.
// Miss-analysis: the exit rows pressed only Mod+B in a bold, so a chord swallowed whole stayed green.
describe.each([
	['bold', '**', 'i', 'a **two** *x*\n'],
	['bold', '**', 'b', 'a **two** x\n'],
	['emphasis', '*', 'i', 'a *two* x\n'],
	['emphasis', '*', 'b', 'a *two* **x**\n']
])('a held space after %s', (_name, delimiter, chord, want) => {
	it(`then Mod+${chord} types ${JSON.stringify(want)}`, async () => {
		const { editor, el } = mountWithCaret(`a ${delimiter}two${delimiter}\n`, 5 + delimiter.length);
		await insertBy('hardware key', el, ' ');

		await pressKey(el, { key: chord, ctrlKey: true });
		await insertBy('hardware key', el, 'x');

		expect(editor.source()).toBe(want);
	});
});

describe('the hold ends without touching the bytes', () => {
	// jsdom moves no caret on an arrow, so this reads only the record the key ends; the browser's
	// move is `drawn-caret-look.spec.ts`.
	it('an arrow key, mid-line', async () => {
		const { editor, el } = mountWithCaret('a **two** b\n', 7);
		await insertBy('hardware key', el, ' ');

		await pressKey(el, { key: 'ArrowRight' });
		await insertBy('hardware key', el, 'w');

		expect(editor.source()).toBe('a **two** w b\n');
	});

	it('End at the line’s end', async () => {
		const { editor, el } = mountWithCaret('a **two**\n', 7);
		await insertBy('hardware key', el, ' ');

		await pressKey(el, { key: 'End' });
		await insertBy('hardware key', el, 'w');

		expect(editor.source()).toBe('a **two** w\n');
	});

	it('a click away leaves `a **two** ` as it is', async () => {
		const editor = mountEditor({ source: 'a **two**\n\nnext\n', presentationMode: 'live' });
		const el = surfaceAt(editor, [0]);
		placeCaret(el, 7);
		await insertBy('hardware key', el, ' ');

		placeCaret(surfaceAt(editor, [1]), 2);
		surfaceAt(editor, [1]).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		await editor.settle();
		expect(editor.source()).toBe('a **two** \n\nnext\n');

		placeCaret(el, 10);
		await insertBy('hardware key', el, 'w');
		expect(editor.source()).toBe('a **two** w\n\nnext\n');
	});

	it('source mode writes every byte where the caret shows it', async () => {
		const { editor, el } = mountWithCaret('a **two**\n', 7, 'source');

		await insertBy('hardware key', el, ' w');

		expect(editor.source()).toBe('a **two w**\n');
	});
});
