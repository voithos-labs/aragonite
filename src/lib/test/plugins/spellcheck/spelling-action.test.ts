// @vitest-environment jsdom
// The Spelling action as an editor lists it: what it captures around a caret or a selection, the
// rows it offers there, and what a picked row writes through the draft the editor opens for it.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPluginList } from '#lib/schema/plugin-unit.js';
import type { ActionRow, Captured, Draft, Editor, SelectionAction } from '#lib/plugin.js';
import { spellcheckPlugin, type SpellcheckOptions } from '#packages/spellcheck/src/index.js';
import type { Dictionary } from '#packages/spellcheck/src/dictionary.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { readingEditor } from './reading-editor';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const SUGGESTIONS: Record<string, string[]> = { teh: ['the', 'ten'], speling: [] };

function dictionary(over: Partial<Dictionary> = {}): Dictionary {
	return {
		check: (word) => !(word in SUGGESTIONS),
		suggest: (word) => SUGGESTIONS[word] ?? [],
		...over
	};
}

/** The plugin's one action, read the way an editor reads its list. */
function spellingAction(options: Partial<SpellcheckOptions> = {}): SelectionAction {
	const plugin = spellcheckPlugin({
		dictionary: dictionary(),
		...options
	});
	const [installed] = installPluginList([plugin], (error) => {
		throw error.cause;
	});
	const [action] = installed.contribution.selectionActions ?? [];
	return action;
}

// Twenty bytes ahead of the line, so its words sit at 24 (`teh`) and 30 (the code span's).
const DOC = 'Padding paragraph.\n\nsay teh `teh` cat\n';
let editor: Editor;
beforeEach(async () => void ({ editor } = await readingEditor(DOC)));

function captured(range: { from: number; to: number }, text: string): Captured {
	return { text, range, box: null, editable: true };
}

async function rowsOver(action: SelectionAction, word: Captured): Promise<readonly ActionRow[]> {
	return await action.rows(word);
}

function recordingDraft(): Draft & { writes: unknown[] } {
	const writes: unknown[] = [];
	const draft = {
		writes,
		replace(range: unknown, text: string) {
			writes.push({ range, text });
			return draft;
		},
		commit: vi.fn(async (options?: unknown) => (writes.push({ commit: options }), { ok: true })),
		end: vi.fn()
	};
	return draft as unknown as Draft & { writes: unknown[] };
}

describe('what the Spelling action captures', () => {
	it('leads the right-click menu as one Spelling group, finding suggestions meanwhile', () => {
		const action = spellingAction();
		expect([action.label, action.lead, action.pending]).toEqual([
			'Spelling',
			true,
			'Finding suggestions…'
		]);
	});

	it('takes the misspelled word under a caret, its end included, and nothing at a right one', () => {
		const action = spellingAction();
		expect(action.capture!(editor, { from: 25, to: 25 })).toEqual({ from: 24, to: 27 });
		expect(action.capture!(editor, { from: 27, to: 27 })).toEqual({ from: 24, to: 27 });
		expect(action.capture!(editor, { from: 21, to: 21 })).toBeNull();
	});

	it('takes a selection only when it is exactly the misspelled word', () => {
		const action = spellingAction();
		expect(action.capture!(editor, { from: 24, to: 27 })).toEqual({ from: 24, to: 27 });
		expect(action.capture!(editor, { from: 24, to: 26 })).toBeNull();
		expect(action.capture!(editor, { from: 20, to: 27 })).toBeNull();
	});

	it('reads no pieces for a selection holding a space, which the toolbar asks about per change', () => {
		const block = editor.blockAt(20)!;
		let reads = 0;
		const counted = Object.create(block, { pieces: { get: () => (reads++, block.pieces) } });
		const reader = { blockAt: () => counted } as unknown as Editor;
		expect(spellingAction().capture!(reader, { from: 20, to: 27 })).toBeNull();
		expect(reads).toBe(0);
	});

	// Miss-analysis: every capture row read a word mid-line in an LF document, so a quote line's
	// last word under CRLF, whose end the byte map read one past its `\r`, was never offered.
	it.each([
		['LF', '\n'],
		['CRLF', '\r\n']
	])(
		"takes a quote line's last word under %s, by a caret at its end or its selection",
		async (_ending, eol) => {
			const source = 'intro\n\n> say teh\n> more teh\n'.replaceAll('\n', eol);
			const quoted = (await readingEditor(source)).editor;
			const action = spellingAction();
			const lines = [source.indexOf(`teh${eol}`), source.lastIndexOf(`teh${eol}`)];
			const caught = lines.flatMap((at) => [
				action.capture!(quoted, { from: at + 3, to: at + 3 }),
				action.capture!(quoted, { from: at, to: at + 3 })
			]);
			expect(caught).toEqual(lines.flatMap((at) => [0, 1].map(() => ({ from: at, to: at + 3 }))));
			const open = `intro${eol}${eol}> say teh`;
			const end = open.length;
			const last = (await readingEditor(open)).editor;
			expect(action.capture!(last, { from: end, to: end })).toEqual({ from: end - 3, to: end });
		}
	);

	it('never takes a word inside a code span', () => {
		expect(spellingAction().capture!(editor, { from: 30, to: 30 })).toBeNull();
	});
});

describe('the rows over a captured word', () => {
	const teh = captured({ from: 24, to: 27 }, 'teh');

	it('lists the suggestions, with Add to dictionary only where the dictionary keeps words', async () => {
		const plain = await rowsOver(spellingAction(), teh);
		expect(plain.map((row) => row.label)).toEqual(['the', 'ten']);

		const keeping = spellingAction({ dictionary: dictionary({ add: () => {} }) });
		expect((await rowsOver(keeping, teh)).map((row) => row.label)).toEqual([
			'the',
			'ten',
			'Add to dictionary'
		]);
	});

	it('offers a dimmed row for a word with no suggestions', async () => {
		const rows = await rowsOver(spellingAction(), captured({ from: 0, to: 7 }, 'speling'));
		expect(rows.map((row) => [row.label, row.disabled])).toEqual([['No suggestions', true]]);
	});

	it('answers with a promise while the suggestions are on their way', async () => {
		let answer!: (list: string[]) => void;
		const slow = dictionary({ suggest: () => new Promise((resolve) => (answer = resolve)) });
		const rows = spellingAction({ dictionary: slow }).rows(teh);
		expect(rows).toBeInstanceOf(Promise);
		answer(['the']);
		expect((await rows).map((row) => row.label)).toEqual(['the']);
	});

	it('writes a pick over the word through its draft, the caret after the new word', async () => {
		const [first] = await rowsOver(spellingAction(), teh);
		const draft = recordingDraft();
		await first.run(draft);
		expect(draft.writes).toEqual([
			{ range: { from: 24, to: 27 }, text: 'the' },
			{ commit: { caret: 27 } }
		]);
	});

	it('adds the word through Add to dictionary, writing nothing', async () => {
		const add = vi.fn();
		const action = spellingAction({ dictionary: dictionary({ add }) });
		const rows = await rowsOver(action, teh);
		const draft = recordingDraft();
		await rows.at(-1)!.run(draft);
		expect(add).toHaveBeenCalledWith('teh');
		expect(draft.writes).toEqual([]);
	});
});
