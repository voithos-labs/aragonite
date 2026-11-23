/**
 * The gestures `scripts/ci/perf-ab.mjs` times on several builds of the editor in one job. Each row
 * is one gesture on a loaded document, timed in the page from the key's keydown to the frame after
 * the tree first changes, and checked for the edit it made. `ROWS` names each row's key: the plain
 * key the gesture is ruled to cost the same as, so a slow gesture reads against it on one build.
 *
 * The probe runs from the tool's checkout against each build's production preview, so every build
 * is driven and timed by the same code; the page side it needs is real keys, the clipboard and the
 * harness's `window.__test` bridge. A row whose bridge call, plugin or edit a build lacks reports
 * "not on this ref" for that build instead of failing.
 *
 * Nothing reads the whole document between an undo and the next timed key: the editor serializes
 * once per content version, and a read there would hand the key a serialization already made.
 */

import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EditorPage } from '../editor-page';
import { gotoReady } from '../goto-ready';
import { percentileMs } from '../tests/perf/latency-harness';
import { generateFixture, generateTriggerDense } from '../../test/perf/fixtures/generate';

declare const process: { env: Record<string, string | undefined> };

const RESULTS = process.env.PERF_AB_RESULTS;
test.skip(!process.env.PERF_AB_URL || !RESULTS, 'run through `node scripts/ci/perf-ab.mjs`');

/* ---- The rows ---- */

const ROWS = {
	'range-delete': { label: 'Delete over three paragraphs, middle to middle' },
	'range-backspace': { label: 'Backspace over the same range', key: ['range-delete'] },
	'range-letter': { label: 'a letter typed over the range', key: ['range-delete'] },
	'range-paste-line': { label: 'a paste of "one" over the range', key: ['range-delete'] },
	'range-paste-paragraphs': {
		label: 'a paste of "one\\n\\ntwo" over the range',
		key: ['range-delete']
	},
	'range-enter': { label: 'Enter over the range', key: ['range-delete'] },
	'range-shift-enter': { label: 'Shift+Enter over the range', key: ['range-delete'] },
	'whole-delete': { label: 'Delete over a divider held whole and the two paragraphs under it' },
	'whole-letter': { label: 'a letter typed over those blocks', key: ['whole-delete'] },
	'whole-enter': { label: 'Enter over those blocks', key: ['whole-delete'] },
	'whole-paste-line': { label: 'a paste of "one" over those blocks', key: ['whole-delete'] },
	'caret-letter': { label: 'a letter typed mid-paragraph (the control)' },
	'caret-enter': { label: 'Enter at a paragraph end' },
	'caret-paste-paragraphs': { label: 'a paste of "one\\n\\ntwo" mid-paragraph' },
	'caret-paste-text': { label: 'a paste of "one\\ntwo" at a paragraph end' },
	'blocks-letter': { label: 'a letter typed at the end of the first block' },
	'prose-letter': { label: 'a letter typed at the end of the first block, flat prose' },
	'list-letter': { label: 'a letter typed in the first item of a giant bullet list' },
	'list-enter': { label: 'Enter at an item end, giant bullet list' },
	'list-enter-exit': { label: 'a second Enter, on the empty item the first opened' },
	'list-paste-ending': { label: 'a paste of "x\\n" at an item end', key: ['list-enter'] },
	'list-paste-two-endings': {
		label: 'a paste of "x\\n\\n" at an item end',
		key: ['list-enter', 'list-enter-exit']
	},
	'ordered-enter': { label: 'Enter at an item end, giant ordered list' },
	'ordered-paste-ending': { label: 'a paste of "x\\n" at an item end', key: ['ordered-enter'] },
	'fence-letter': { label: 'a letter typed at the end of a 60-line code fence, live mode' },
	'code-letter-500': { label: 'a letter typed at the end of a 500-line code fence, live mode' },
	'fixed-fence-letter': {
		label: 'a letter typed at the end of a 500-line `%%%` block a plugin draws, live mode'
	},
	'footnote-letter': {
		label: 'a letter typed in prose dense with footnote references and [[wiki]] links'
	},
	'emoji-letter': { label: 'a letter typed at the end of a paragraph of fifty :shortcode: emoji' },
	'occurrence-letter': {
		label: 'a letter typed into a marked word in the middle of 2,000 paragraphs'
	},
	'toc-heading-letter': {
		label: 'a letter typed into a heading under a table of contents of 2,000 headings'
	}
} as const;

type RowId = keyof typeof ROWS;

interface Row {
	label: string;
	/** The rows whose summed time this row is ruled to equal. */
	key?: readonly RowId[];
}

// Typed apart from the table, which a type naming its own keys can't annotate, so a key naming no
// row fails the type check here.
const rows: Record<RowId, Row> = ROWS;

/* ---- Results ---- */

function write(id: RowId, result: object): void {
	mkdirSync(RESULTS!, { recursive: true });
	const order = Object.keys(rows).indexOf(id);
	const row = rows[id];
	const line = JSON.stringify({ id, order, label: row.label, key: row.key ?? [], ...result });
	writeFileSync(path.join(RESULTS!, `${id}.json`), line + '\n');
}

/** `change` is what the last sample's edit did to the watched blocks, so a reader sees whether
 *  every build made the same edit. */
function report(id: RowId, samples: number[], change: Change): void {
	const p50Ms = percentileMs(samples, 50);
	write(id, { samples, p50Ms, p95Ms: percentileMs(samples, 95), change });
}

/** Records the row as one this build cannot run, and ends the test there. */
function absent(id: RowId, reason: string): never {
	write(id, { absent: reason });
	test.skip(true, `not on this ref: ${reason}`);
	throw new Error('unreachable');
}

/* ---- The page side ---- */

/** What a row watches: the top-level block count, and the raw length of `span` siblings from `path`. */
interface Watch {
	path: number[];
	span?: number;
}

interface Snapshot {
	blocks: number;
	bytes: number;
}

type Change = Snapshot;

type Timed = { ms: number; change: Change } | { unheard: true } | { unchanged: true };

/** Installs `window.__ab`: the watched snapshot, and a timer armed on one key. Runs in the page. */
function installInPage(): void {
	const w = window as any;
	const snapshot = ({ path, span = 1 }: Watch): Snapshot => {
		const doc = w.__test.getDocument();
		let parent = doc;
		for (const i of path.slice(0, -1)) parent = parent.children[i];
		const first = path[path.length - 1];
		let bytes = 0;
		for (let i = first; i < first + span; i++) bytes += parent.children[i]?.raw.length ?? 0;
		return { blocks: doc.children.length, bytes };
	};
	const arm = (key: string, watch: Watch, base: Snapshot, deadline: number) => {
		w.__ab.timed = new Promise<Timed>((done) => {
			// A deadline, not an order: a key that never reaches the page ends the row.
			const unheard = setTimeout(() => done({ unheard: true }), deadline);
			const onKey = (e: KeyboardEvent) => {
				// A chord's modifier goes down first, and the edit belongs to the key after it.
				if (e.key.toLowerCase() !== key) return;
				clearTimeout(unheard);
				window.removeEventListener('keydown', onKey, true);
				const start = performance.now();
				const poll = () =>
					requestAnimationFrame(() => {
						const now = snapshot(watch);
						if (now.blocks !== base.blocks || now.bytes !== base.bytes) {
							requestAnimationFrame(() => {
								const end = snapshot(watch);
								const change = { blocks: end.blocks - base.blocks, bytes: end.bytes - base.bytes };
								done({ ms: performance.now() - start, change });
							});
						} else if (performance.now() - start > deadline) done({ unchanged: true });
						else poll();
					});
				poll();
			};
			window.addEventListener('keydown', onKey, true);
		});
	};
	w.__ab = { snapshot, arm };
}

const snapshot = (page: Page, watch: Watch): Promise<Snapshot> =>
	page.evaluate((watch) => (window as any).__ab.snapshot(watch), watch);

/** The bridge calls a row makes, each checked before the row starts. */
const BRIDGE = [
	'setSource',
	'getSource',
	'getDocument',
	'placeCaret',
	'setSelection',
	'getSelection',
	'isBlockMounted',
	'rects.scrollTo'
];

/** Opens the row's route, checks the build has every bridge call in `needs`, and loads `source`,
 *  keeping its trimmed bytes in the page as what each edit and the last undo are checked against. */
async function load(
	page: Page,
	id: RowId,
	source: string,
	open: (editor: EditorPage) => Promise<void> = (editor) => editor.goto(),
	needs: readonly string[] = BRIDGE
): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await open(editor);
	const missing = await page.evaluate((needs) => {
		const t = (window as any).__test;
		return needs.filter(
			(name) => typeof name.split('.').reduce((at: any, key) => at?.[key], t) !== 'function'
		);
	}, needs);
	if (missing.length > 0) absent(id, `the bridge has no ${missing.join(', ')}`);
	await page.evaluate(installInPage);
	const trimmed = source.replace(/\s+$/, '');
	await page.evaluate(
		({ source, trimmed }) => {
			(window as any).__abBefore = trimmed;
			return (window as any).__test.setSource(source);
		},
		{ source, trimmed }
	);
	await page.waitForFunction(
		(length) => {
			const doc = (window as any).__test.getDocument();
			let at = doc.prefix.length + doc.suffix.length;
			for (const child of doc.children) at += child.leadingTrivia.length + child.raw.length;
			return at >= length;
		},
		trimmed.length,
		{ timeout: LOAD_TIMEOUT_MS, polling: 16 }
	);
	await editor.waitForRenderFlush();
	return editor;
}

/** Times `press` from the keydown of `key` to the frame after `watch` first changes. */
async function timedKey(
	page: Page,
	key: string,
	watch: Watch,
	press: () => Promise<void>,
	deadline: number
): Promise<Timed> {
	const base = await snapshot(page, watch);
	await page.evaluate(
		({ key, watch, base, deadline }) => (window as any).__ab.arm(key, watch, base, deadline),
		{ key, watch, base, deadline }
	);
	await press();
	return page.evaluate(() => (window as any).__ab.timed as Promise<Timed>);
}

/** Undoes until `watch` reads `loaded` again; a paste may take two steps on some builds. */
async function undoTo(editor: EditorPage, watch: Watch, loaded: Snapshot): Promise<void> {
	for (let step = 0; step < 3; step++) {
		await editor.undo();
		await editor.waitForRenderFlush();
		const now = await snapshot(editor.page, watch);
		if (now.blocks === loaded.blocks && now.bytes === loaded.bytes) return;
	}
	throw new Error('three undos did not put the watched blocks back');
}

/** Throws unless the source is the loaded one, naming the first byte that differs. */
async function expectRestored(page: Page): Promise<void> {
	const diff = await page.evaluate(() => {
		const w = window as any;
		const actual: string = w.__test.getSource().replace(/\s+$/, '');
		const wanted: string = w.__abBefore;
		if (actual === wanted) return null;
		let at = 0;
		while (at < actual.length && actual[at] === wanted[at]) at++;
		const near = (s: string) => JSON.stringify(s.slice(Math.max(0, at - 20), at + 20));
		return `${near(actual)} at byte ${at}, wanted ${near(wanted)}`;
	});
	if (diff !== null) throw new Error(`the undos left ${diff}`);
}

/* ---- Sampling ---- */

const LOAD_TIMEOUT_MS = 480_000;
// The first sample is unmeasured, and a build where the key does nothing fails it fast.
const FIRST_DEADLINE_MS = 15_000;
const DEADLINE_MS = 60_000;

interface EditRow {
	/** Puts the caret or the range where every sample starts; an edit it makes is undone too. */
	place: () => Promise<void>;
	key: string;
	press: () => Promise<void>;
	watch: Watch;
	/** What is wrong with the edit, or null. */
	check?: () => Promise<string | null>;
	samples: number;
}

/** One unmeasured sample, then `samples` timed ones, each undone before the next. */
async function editRow(editor: EditorPage, id: RowId, row: EditRow): Promise<void> {
	const page = editor.page;
	const samples: number[] = [];
	let change: Change = { blocks: 0, bytes: 0 };
	for (let i = -1; i < row.samples; i++) {
		const loaded = await snapshot(page, row.watch);
		await row.place();
		await editor.waitForRenderFlush();
		const deadline = i < 0 ? FIRST_DEADLINE_MS : DEADLINE_MS;
		const timed = await timedKey(page, row.key, row.watch, row.press, deadline);
		if ('unheard' in timed) throw new Error(`no ${row.key} keydown reached the page`);
		if ('unchanged' in timed) {
			if (i < 0) absent(id, `${row.key} changed nothing`);
			throw new Error(`${row.key} left the watched blocks as they were`);
		}
		const wrong = (await row.check?.()) ?? null;
		if (wrong !== null) {
			if (i < 0) absent(id, `the edit left ${wrong}`);
			throw new Error(`the edit left ${wrong}`);
		}
		if (i >= 0) samples.push(timed.ms);
		change = timed.change;
		await undoTo(editor, row.watch, loaded);
	}
	await expectRestored(page);
	report(id, samples, change);
}

/** `keys` letters typed in a row after one unmeasured letter, each timed to the watched block
 *  growing; the source is then checked for exactly those letters and nothing else. */
async function letterRow(editor: EditorPage, id: RowId, watch: Watch, keys: number): Promise<void> {
	const page = editor.page;
	const samples: number[] = [];
	let change: Change = { blocks: 0, bytes: 0 };
	for (let i = -1; i < keys; i++) {
		const deadline = i < 0 ? FIRST_DEADLINE_MS : DEADLINE_MS;
		const timed = await timedKey(page, 'x', watch, () => page.keyboard.press('x'), deadline);
		if ('unheard' in timed) throw new Error('no x keydown reached the page');
		if ('unchanged' in timed) {
			if (i < 0) absent(id, 'a typed letter changed nothing');
			throw new Error('a typed letter left the watched block as it was');
		}
		if (i >= 0) samples.push(timed.ms);
		change = timed.change;
	}
	const wrong = await insertedOnly(page, 'x'.repeat(keys + 1));
	if (wrong !== null) throw new Error(`the letters left ${wrong}`);
	report(id, samples, change);
}

/** What is wrong with the source if it isn't the loaded one with `text` inserted in one place. */
function insertedOnly(page: Page, text: string): Promise<string | null> {
	return page.evaluate((text) => {
		const w = window as any;
		const before: string = w.__abBefore;
		const after: string = w.__test.getSource().replace(/\s+$/, '');
		let head = 0;
		while (head < before.length && before[head] === after[head]) head++;
		let tail = 0;
		while (
			tail < before.length - head &&
			before[before.length - 1 - tail] === after[after.length - 1 - tail]
		)
			tail++;
		const removed = before.slice(head, before.length - tail);
		const inserted = after.slice(head, after.length - tail);
		if (removed === '' && inserted === text) return null;
		return `${JSON.stringify(inserted.slice(0, 40))} for ${JSON.stringify(removed.slice(0, 40))} at byte ${head}`;
	}, text);
}

/* ---- A document of many small paragraphs ---- */

const FIXTURE_BYTES = 1_000_000;
const RANGE_SAMPLES = 20;
const LEAF_SAMPLES = 12;
const TYPED_KEYS = 40;

const smallBlocks = () => generateFixture('many-small-blocks', FIXTURE_BYTES);

/** The small-blocks document with its middle block a divider, so a range from it to the end of the
 *  paragraph two below holds every block it touches whole. */
function dividedBlocks(): string {
	const blocks = smallBlocks().split('\n\n');
	// What follows the last blank line is empty, and no block.
	blocks[Math.floor((blocks.length - 1) / 2)] = '***';
	return blocks.join('\n\n');
}

const PARAGRAPHS = ['paragraph', 'paragraph', 'paragraph'];

/** Loads `source` and returns the middle top-level index, the first of three blocks of `kinds`
 *  every range and caret row there lands in. */
async function loadMiddle(
	page: Page,
	id: RowId,
	source = smallBlocks(),
	kinds: readonly string[] = PARAGRAPHS
): Promise<{ editor: EditorPage; middle: number }> {
	const editor = await load(page, id, source);
	const { middle, found } = await page.evaluate(() => {
		const children = (window as any).__test.getDocument().children;
		const middle = Math.floor(children.length / 2);
		return { middle, found: [0, 1, 2].map((k) => children[middle + k].kind as string) };
	});
	if (found.join() !== kinds.join())
		throw new Error(
			`blocks ${middle}..${middle + 2} are ${found.join(', ')}, not ${kinds.join(', ')}`
		);
	return { editor, middle };
}

/** Scrolls block `first` into the window and returns the text length of each block up to `last`:
 *  its raw bytes less the line ending they end with. */
async function bringIntoView(page: Page, first: number, last: number): Promise<number[]> {
	await page.evaluate(
		(path) => (window as any).__test.rects.scrollTo(path, { block: 'center' }),
		[first]
	);
	await new EditorPage(page).waitForRenderFlush();
	return page.evaluate(
		({ first, last }) => {
			const t = (window as any).__test;
			const lengths: number[] = [];
			for (let i = first; i <= last; i++) {
				if (!t.isBlockMounted([i])) throw new Error(`block ${i} is not mounted`);
				lengths.push(t.getDocument().children[i].raw.replace(/\r?\n$/, '').length);
			}
			return lengths;
		},
		{ first, last }
	);
}

/** The document byte at `offset` into top-level block `block`. */
function byteAt(page: Page, block: number, offset: number): Promise<number> {
	return page.evaluate(
		({ block, offset }) => {
			const doc = (window as any).__test.getDocument();
			let at = doc.prefix.length;
			for (let i = 0; i < block; i++)
				at += doc.children[i].leadingTrivia.length + doc.children[i].raw.length;
			return at + doc.children[block].leadingTrivia.length + offset;
		},
		{ block, offset }
	);
}

/** What is wrong with the source if it doesn't keep the loaded bytes around `remove` bytes from
 *  `at`, with bytes there whose non-whitespace is one of `inks`. */
function splicedAt(
	page: Page,
	at: number,
	remove: number,
	inks: readonly string[]
): Promise<string | null> {
	return page.evaluate(
		({ at, remove, inks }) => {
			const w = window as any;
			const before: string = w.__abBefore;
			const after: string = w.__test.getSource().replace(/\s+$/, '');
			const tail = before.length - at - remove;
			const kept =
				after.length >= at + tail &&
				after.slice(0, at) === before.slice(0, at) &&
				after.slice(after.length - tail) === before.slice(before.length - tail);
			const ink = after.slice(at, after.length - tail).replace(/\s+/g, '');
			if (kept && inks.includes(ink)) return null;
			return `${JSON.stringify(after.slice(Math.max(0, at - 20), at + 40))} around byte ${at}`;
		},
		{ at, remove, inks }
	);
}

/** Selects `from` in block `first` to `to` two blocks below, the caret at `caret` first; what it
 *  reads back as where that isn't the range asked, since `setSelection` answers only a boolean. */
async function misselected(
	page: Page,
	first: number,
	from: number,
	to: number,
	caret: [block: number, offset: number]
): Promise<string | null> {
	const last = first + 2;
	await bringIntoView(page, first, last);
	await new EditorPage(page).focusBlockAtPath([caret[0]], caret[1]);
	const got = await page.evaluate(
		async ({ first, last, from, to }) => {
			const t = (window as any).__test;
			const range = {
				anchor: { path: [first], offset: from },
				focus: { path: [last], offset: to }
			};
			if (!(await t.setSelection(range))) return 'declined';
			const sel = t.getSelection();
			const at = (p: { path: number[]; offset: number } | undefined) =>
				p ? `${p.path.join('.')}@${p.offset}` : 'none';
			return `${at(sel?.anchor)} to ${at(sel?.focus)}`;
		},
		{ first, last, from, to }
	);
	const wanted = `${first}@${from} to ${last}@${to}`;
	return got === wanted ? null : `the selection is ${got}, wanted ${wanted}`;
}

interface RangeGesture {
	key: string;
	press: (editor: EditorPage) => Promise<void>;
	/** The non-whitespace the edit may put where the range was. */
	inks: readonly string[];
	clip?: string;
}

/** Where a range row's range runs, how it is drawn, and the bytes its edit may change (`changes`,
 *  from `at`, whitespace aside). */
interface Span {
	source: () => string;
	kinds: readonly string[];
	ends: (first: number, third: number) => [from: number, to: number];
	select: (page: Page, id: RowId, first: number, from: number, to: number) => Promise<void>;
	changes: (
		page: Page,
		first: number,
		from: number,
		to: number
	) => Promise<[at: number, remove: number]>;
}

/** The middle of one paragraph to the middle of the paragraph two below. */
const MIDDLES: Span = {
	source: smallBlocks,
	kinds: PARAGRAPHS,
	ends: (first, third) => [Math.floor(first / 2), Math.floor(third / 2)],
	async select(page, _id, first, from, to) {
		const wrong = await misselected(page, first, from, to, [first, from]);
		if (wrong !== null) throw new Error(wrong);
	},
	async changes(page, first, from, to) {
		const at = await byteAt(page, first, from);
		return [at, (await byteAt(page, first + 2, to)) - at];
	}
};

/** A divider held whole to the end of the paragraph two below: no text kept at either end. A build
 *  that reads the range back otherwise can't run the row. */
const WHOLE: Span = {
	source: dividedBlocks,
	kinds: ['thematicBreak', 'paragraph', 'paragraph'],
	ends: (_first, third) => [0, third],
	async select(page, id, first, from, to) {
		const wrong = await misselected(page, first, from, to, [first + 2, to]);
		if (wrong !== null) absent(id, wrong);
	},
	// A block taken whole takes a blank line beside it, so the blank lines around the range count.
	async changes(page, first) {
		const above = await page.evaluate(
			(block) => (window as any).__test.getDocument().children[block].raw.replace(/\r?\n$/, ''),
			first - 1
		);
		const at = await byteAt(page, first - 1, above.length);
		return [at, (await byteAt(page, first + 3, 0)) - at];
	}
};

async function rangeRow(
	page: Page,
	id: RowId,
	gesture: RangeGesture,
	span: Span = MIDDLES
): Promise<void> {
	const { editor, middle } = await loadMiddle(page, id, span.source(), span.kinds);
	const [firstLength, , thirdLength] = await bringIntoView(page, middle, middle + 2);
	const [from, to] = span.ends(firstLength, thirdLength);
	const [at, remove] = await span.changes(page, middle, from, to);
	if (gesture.clip !== undefined) await editor.seedClipboard(gesture.clip);
	await editRow(editor, id, {
		place: () => span.select(page, id, middle, from, to),
		key: gesture.key,
		press: () => gesture.press(editor),
		watch: { path: [middle], span: 3 },
		check: () => splicedAt(page, at, remove, gesture.inks),
		samples: RANGE_SAMPLES
	});
}

const pressing = (chord: string) => (editor: EditorPage) => editor.page.keyboard.press(chord);
const pasting = (editor: EditorPage) => editor.paste();

test.describe('perf a/b: over a range across three paragraphs, 1 MB of small blocks', () => {
	test('range-delete', async ({ page }) => {
		await rangeRow(page, 'range-delete', { key: 'delete', press: pressing('Delete'), inks: [''] });
	});

	test('range-backspace', async ({ page }) => {
		await rangeRow(page, 'range-backspace', {
			key: 'backspace',
			press: pressing('Backspace'),
			inks: ['']
		});
	});

	test('range-letter', async ({ page }) => {
		await rangeRow(page, 'range-letter', { key: 'x', press: pressing('x'), inks: ['x'] });
	});

	test('range-paste-line', async ({ page }) => {
		await rangeRow(page, 'range-paste-line', {
			key: 'v',
			press: pasting,
			inks: ['one'],
			clip: 'one'
		});
	});

	test('range-paste-paragraphs', async ({ page }) => {
		await rangeRow(page, 'range-paste-paragraphs', {
			key: 'v',
			press: pasting,
			inks: ['onetwo'],
			clip: 'one\n\ntwo'
		});
	});

	test('range-enter', async ({ page }) => {
		await rangeRow(page, 'range-enter', { key: 'enter', press: pressing('Enter'), inks: [''] });
	});

	test('range-shift-enter', async ({ page }) => {
		// A hard line break is written as a backslash or as trailing spaces, whichever the build uses.
		await rangeRow(page, 'range-shift-enter', {
			key: 'enter',
			press: pressing('Shift+Enter'),
			inks: ['', '\\']
		});
	});
});

test.describe('perf a/b: over a divider held whole and two paragraphs, 1 MB of small blocks', () => {
	test('whole-delete', async ({ page }) => {
		const gesture = { key: 'delete', press: pressing('Delete'), inks: [''] };
		await rangeRow(page, 'whole-delete', gesture, WHOLE);
	});

	test('whole-letter', async ({ page }) => {
		await rangeRow(page, 'whole-letter', { key: 'x', press: pressing('x'), inks: ['x'] }, WHOLE);
	});

	test('whole-enter', async ({ page }) => {
		const gesture = { key: 'enter', press: pressing('Enter'), inks: [''] };
		await rangeRow(page, 'whole-enter', gesture, WHOLE);
	});

	test('whole-paste-line', async ({ page }) => {
		const gesture = { key: 'v', press: pasting, inks: ['one'], clip: 'one' };
		await rangeRow(page, 'whole-paste-line', gesture, WHOLE);
	});
});

test.describe('perf a/b: at a caret, 1 MB of small blocks', () => {
	test('caret-letter', async ({ page }) => {
		const { editor, middle } = await loadMiddle(page, 'caret-letter');
		const [length] = await bringIntoView(page, middle, middle);
		await editor.focusBlockAtPath([middle], Math.floor(length / 2));
		await letterRow(editor, 'caret-letter', { path: [middle] }, TYPED_KEYS);
	});

	test('caret-enter', async ({ page }) => {
		const { editor, middle } = await loadMiddle(page, 'caret-enter');
		const [length] = await bringIntoView(page, middle, middle);
		const at = await byteAt(page, middle, length);
		await editRow(editor, 'caret-enter', {
			place: async () => {
				await bringIntoView(page, middle, middle);
				await editor.focusBlockAtPath([middle], length);
			},
			key: 'enter',
			press: () => page.keyboard.press('Enter'),
			watch: { path: [middle] },
			check: () => splicedAt(page, at, 0, ['']),
			samples: RANGE_SAMPLES
		});
	});

	test('caret-paste-paragraphs', async ({ page }) => {
		const { editor, middle } = await loadMiddle(page, 'caret-paste-paragraphs');
		const [length] = await bringIntoView(page, middle, middle);
		const offset = Math.floor(length / 2);
		const at = await byteAt(page, middle, offset);
		await editor.seedClipboard('one\n\ntwo');
		await editRow(editor, 'caret-paste-paragraphs', {
			place: async () => {
				await bringIntoView(page, middle, middle);
				await editor.focusBlockAtPath([middle], offset);
			},
			key: 'v',
			press: () => editor.paste(),
			watch: { path: [middle] },
			check: () => splicedAt(page, at, 0, ['onetwo']),
			samples: RANGE_SAMPLES
		});
	});

	test('caret-paste-text', async ({ page }) => {
		const { editor, middle } = await loadMiddle(page, 'caret-paste-text');
		const [length] = await bringIntoView(page, middle, middle);
		const at = await byteAt(page, middle, length);
		await editor.seedClipboard('one\ntwo');
		await editRow(editor, 'caret-paste-text', {
			place: async () => {
				await bringIntoView(page, middle, middle);
				await editor.focusBlockAtPath([middle], length);
			},
			key: 'v',
			press: () => editor.paste(),
			watch: { path: [middle] },
			check: () => splicedAt(page, at, 0, ['onetwo']),
			samples: LEAF_SAMPLES
		});
	});
});

/* ---- Letters typed into other documents ---- */

/** Lines of JavaScript in a fence, the shape the highlighting rows type into. */
function codeFence(lines: number): string {
	const body = Array.from({ length: lines }, (_, i) => `const value${i} = compute(${i}, "row");`);
	return '```js\n' + body.join('\n') + '\n```\n\nafter\n';
}

/** Footnote-dense prose (the typing harness's bracket rows) with a `[[wiki]]` link in each
 *  paragraph, which stays bracket text on a route without the wiki-link plugin. */
function footnoteDense(bytes: number): string {
	let n = 0;
	return generateTriggerDense('bracket-footnote', bytes).replace(
		/\.\n\n/g,
		() => ` [[Note ${n++}]].\n\n`
	);
}

test.describe('perf a/b: a letter typed into other documents', () => {
	test('blocks-letter', async ({ page }) => {
		const editor = await load(page, 'blocks-letter', smallBlocks());
		await editor.focusBlockAtPath([0], Number.MAX_SAFE_INTEGER);
		await letterRow(editor, 'blocks-letter', { path: [0] }, TYPED_KEYS);
	});

	test('prose-letter', async ({ page }) => {
		const prose = generateFixture('flat-prose', FIXTURE_BYTES);
		const editor = await load(page, 'prose-letter', prose);
		await editor.focusBlockAtPath([0], Number.MAX_SAFE_INTEGER);
		await letterRow(editor, 'prose-letter', { path: [0] }, TYPED_KEYS);
	});

	test('list-letter', async ({ page }) => {
		const list = generateFixture('giant-single-list', FIXTURE_BYTES);
		const editor = await load(page, 'list-letter', list);
		await editor.focusBlockAtPath([0, 0, 0], Number.MAX_SAFE_INTEGER);
		await letterRow(editor, 'list-letter', { path: [0] }, TYPED_KEYS);
	});

	test('fence-letter', async ({ page }) => {
		const fence = codeFence(60);
		const live = (editor: EditorPage) => editor.goto('?presentationMode=live');
		const needs = [...BRIDGE, 'parkCaretInBlockComponent'];
		const editor = await load(page, 'fence-letter', fence, live, needs);
		const lastLineEnd = fence.indexOf('\n```\n');
		await page.evaluate(
			(offset) => (window as any).__test.parkCaretInBlockComponent([0], offset),
			lastLineEnd
		);
		await letterRow(editor, 'fence-letter', { path: [0] }, TYPED_KEYS);
	});

	test('code-letter-500', async ({ page }) => {
		const fence = codeFence(500);
		const live = (editor: EditorPage) => editor.goto('?presentationMode=live');
		const needs = [...BRIDGE, 'parkCaretInBlockComponent'];
		const editor = await load(page, 'code-letter-500', fence, live, needs);
		await page.evaluate(
			(offset) => (window as any).__test.parkCaretInBlockComponent([0], offset),
			fence.indexOf('\n```\n')
		);
		await letterRow(editor, 'code-letter-500', { path: [0] }, TYPED_KEYS);
	});

	// The fence lines the editor draws around a plugin's body, against the code block's own.
	test('fixed-fence-letter', async ({ page }) => {
		const fence = codeFence(500).replace('```js\n', '%%%\n').replace('\n```\n', '\n%%%\n');
		const open = async (editor: EditorPage) => {
			await gotoReady(page, '/test/plugins?seed=fence-lines');
			await editor.setPresentationMode('live');
		};
		const needs = [...BRIDGE, 'parkCaretInBlockComponent', 'setPresentationMode'];
		const editor = await load(page, 'fixed-fence-letter', fence, open, needs);
		const kind = await page.evaluate(() => (window as any).__test.getDocument().children[0].kind);
		if (kind !== 'fence-lines/fixed')
			absent('fixed-fence-letter', 'no `%%%` block type on /test/plugins?seed=fence-lines');
		await page.evaluate(
			(offset) => (window as any).__test.parkCaretInBlockComponent([0], offset),
			fence.indexOf('\n%%%\n')
		);
		await letterRow(editor, 'fixed-fence-letter', { path: [0] }, TYPED_KEYS);
	});

	test('footnote-letter', async ({ page }) => {
		const editor = await load(page, 'footnote-letter', footnoteDense(FIXTURE_BYTES), () =>
			gotoReady(page, '/test/plugins?seed=footnotes')
		);
		// The footnote plugin draws each reference; none drawn means it isn't on this route.
		if ((await page.locator('sup.footnote-ref').count()) === 0)
			absent('footnote-letter', 'no footnote reference was drawn on /test/plugins?seed=footnotes');
		const middle = await page.evaluate(() =>
			Math.floor((window as any).__test.getDocument().children.length / 2)
		);
		const [length] = await bringIntoView(page, middle, middle);
		await editor.focusBlockAtPath([middle], length);
		await letterRow(editor, 'footnote-letter', { path: [middle] }, TYPED_KEYS);
	});

	test('emoji-letter', async ({ page }) => {
		const shortcodes = Array.from({ length: 50 }, () => ':smile:').join(' ');
		const source = `lead\n\n${shortcodes} end\n\ntail\n`;
		const editor = await load(page, 'emoji-letter', source, () =>
			gotoReady(page, '/test/plugins?seed=emoji')
		);
		// The emoji plugin draws each shortcode; none drawn means it isn't on this route.
		if ((await page.locator('.md-emoji-widget').count()) === 0)
			absent('emoji-letter', 'no emoji was drawn on /test/plugins?seed=emoji');
		await editor.focusBlockAtPath([1], Number.MAX_SAFE_INTEGER);
		await letterRow(editor, 'emoji-letter', { path: [1] }, TYPED_KEYS);
	});

	test('occurrence-letter', async ({ page }) => {
		const paragraphs = Array.from({ length: 2000 }, (_, i) => `alpha beta gamma ${i}`);
		const source = `${paragraphs.join('\n\n')}\n`;
		const editor = await load(page, 'occurrence-letter', source, () =>
			gotoReady(page, '/test/plugins?seed=hloccur')
		);
		const middle = 1000;
		await bringIntoView(page, middle, middle);
		// After `alpha`, so each key types into the word whose occurrences are marked.
		await editor.focusBlockAtPath([middle], 'alpha'.length);
		const marked = await page
			.locator('.hl-occurrence')
			.first()
			.waitFor({ timeout: 2000 })
			.then(
				() => true,
				() => false
			);
		if (!marked)
			absent('occurrence-letter', 'no occurrence was marked on /test/plugins?seed=hloccur');
		await letterRow(editor, 'occurrence-letter', { path: [middle] }, TYPED_KEYS);
	});

	// The outline reads each heading through `depends`, so a key asks the heading it typed in.
	test('toc-heading-letter', async ({ page }) => {
		const headings = Array.from({ length: 2000 }, (_, i) => `## Heading ${i}`);
		const source = `[[toc]]\n\n${headings.join('\n\n')}\n`;
		const editor = await load(page, 'toc-heading-letter', source, () =>
			gotoReady(page, '/test/plugins?seed=toc')
		);
		// The outline lists each heading; none listed means it isn't on this route.
		if ((await page.locator('.toc-block-item').count()) === 0)
			absent('toc-heading-letter', 'no outline was drawn on /test/plugins?seed=toc');
		const middle = 1000;
		const [length] = await bringIntoView(page, middle, middle);
		await editor.focusBlockAtPath([middle], length);
		await letterRow(editor, 'toc-heading-letter', { path: [middle] }, TYPED_KEYS);
	});
});

/* ---- One giant list ---- */

const LIST_ITEM = 6;
const ITEM_LEAF = [0, LIST_ITEM, 0];

/** `giant-single-list` with every bullet numbered. */
function orderedList(): string {
	let n = 0;
	return generateFixture('giant-single-list', FIXTURE_BYTES).replace(/^- /gm, () => `${++n}. `);
}

/** The raw length of the paragraph in list item `LIST_ITEM`, which must be mounted. */
function itemEnd(page: Page): Promise<number> {
	return page.evaluate((leaf) => {
		const t = (window as any).__test;
		let node = t.getDocument();
		for (const i of leaf) node = node.children[i];
		if (node.kind !== 'paragraph') throw new Error(`${leaf.join('.')} is a ${node.kind}`);
		if (!t.isBlockMounted(leaf)) throw new Error(`block ${leaf.join('.')} is not mounted`);
		return node.raw.length as number;
	}, ITEM_LEAF);
}

type ListGesture =
	{ key: 'enter'; opened?: boolean } | { key: 'v'; clip: string; opened?: undefined };

/** Enter or a paste at the end of item `LIST_ITEM`; `opened` presses one Enter first, untimed, so
 *  the timed Enter lands on the empty item it opened. */
async function listRow(page: Page, id: RowId, list: string, gesture: ListGesture): Promise<void> {
	const editor = await load(page, id, list);
	const watch = { path: [0] };
	const offset = await itemEnd(page);
	const enter = () => page.keyboard.press('Enter');
	if (gesture.key === 'v') await editor.seedClipboard(gesture.clip);
	await editRow(editor, id, {
		place: async () => {
			await editor.focusBlockAtPath(ITEM_LEAF, offset);
			if (!gesture.opened) return;
			const first = await timedKey(page, 'enter', watch, enter, DEADLINE_MS);
			if (!('ms' in first)) throw new Error('the first Enter left the list as it was');
		},
		key: gesture.key,
		press: gesture.key === 'v' ? () => editor.paste() : enter,
		watch,
		samples: LEAF_SAMPLES
	});
}

test.describe('perf a/b: at an item end in a 1 MB list', () => {
	const bullets = () => generateFixture('giant-single-list', FIXTURE_BYTES);

	test('list-enter', async ({ page }) => {
		await listRow(page, 'list-enter', bullets(), { key: 'enter' });
	});

	test('list-enter-exit', async ({ page }) => {
		await listRow(page, 'list-enter-exit', bullets(), { key: 'enter', opened: true });
	});

	test('list-paste-ending', async ({ page }) => {
		await listRow(page, 'list-paste-ending', bullets(), { key: 'v', clip: 'x\n' });
	});

	test('list-paste-two-endings', async ({ page }) => {
		await listRow(page, 'list-paste-two-endings', bullets(), { key: 'v', clip: 'x\n\n' });
	});

	test('ordered-enter', async ({ page }) => {
		await listRow(page, 'ordered-enter', orderedList(), { key: 'enter' });
	});

	test('ordered-paste-ending', async ({ page }) => {
		await listRow(page, 'ordered-paste-ending', orderedList(), { key: 'v', clip: 'x\n' });
	});
});
