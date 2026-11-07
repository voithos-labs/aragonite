import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { parse } from '#lib/core/parser.js';
import { createDecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import { createEditorEvents } from '#lib/editor-events.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import { createSpellState, SPELL_MARK_CLASS } from '#lib/spell/spell-state.svelte.js';
import type { SpellChecker, SpellcheckMode } from '#lib/spell/types.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

// Miss-analysis: the checker contract is async, so a test that only stubs a synchronous one
// would pass a source that never re-runs when a late verdict lands.

/** A checker over a word list, answering at once or through promises the test resolves. */
function scriptedChecker(known: string[], opts: { async?: boolean; addWord?: boolean } = {}) {
	const words = new Set(known);
	const pending = new Map<string, (ok: boolean) => void>();
	const check = vi.fn((word: string): boolean | Promise<boolean> => {
		if (!opts.async) return words.has(word);
		return new Promise<boolean>((resolve) => pending.set(word, resolve));
	});
	const suggest = vi.fn((word: string) => [word.slice(1)]);
	const addWord = vi.fn((word: string) => void words.add(word));
	const checker: SpellChecker =
		opts.addWord === false ? { check, suggest } : { check, suggest, addWord };
	return {
		checker,
		check,
		suggest,
		addWord,
		words,
		/** Answers every pending question from the word list. */
		answerAll(): void {
			for (const [word, resolve] of pending) resolve(words.has(word));
			pending.clear();
		}
	};
}

function harness(
	source: string,
	checker: SpellChecker | null,
	opts: { mode?: SpellcheckMode; mountedRange?: { start: number; end: number } | null } = {}
) {
	const doc = parse(source);
	const engine = createDecorationEngine({ getDoc: () => doc });
	const events = createEditorEvents();
	let selection: EditorSelection | null = null;
	let mountedRange = opts.mountedRange ?? null;
	const replaceRange = vi.fn(async () => true);
	const onError = vi.fn();
	const state = createSpellState({
		getDoc: () => doc,
		reading: fixtureReading(),
		decorations: engine,
		checker,
		mode: opts.mode ?? 'on',
		getSelection: () => selection,
		events,
		mountedRange: () => mountedRange,
		replaceRange,
		onError
	});
	const marks = (path: number[]) =>
		engine.marksForPath(path).map(({ dec }) => [dec.start, dec.end, dec.class]);
	return {
		doc,
		engine,
		events,
		state,
		marks,
		replaceRange,
		onError,
		caretAt(path: number[], offset: number) {
			selection = { anchor: { path, offset }, focus: { path, offset } };
		},
		setMountedRange(range: { start: number; end: number } | null) {
			mountedRange = range;
			state.noteWindowChange();
		}
	};
}

describe('createSpellState: the marks', () => {
	it('underlines the words a synchronous checker refuses, at their raw offsets', () => {
		const { checker, check } = scriptedChecker(['the', 'cat', 'sat']);
		const h = harness('the cat **sta** here\n', checker);
		expect(h.marks([0])).toEqual([
			[10, 13, SPELL_MARK_CLASS],
			[16, 20, SPELL_MARK_CLASS]
		]);
		// One question per distinct word, however often it appears.
		expect(check.mock.calls.map(([w]) => w)).toEqual(['the', 'cat', 'sta', 'here']);
	});

	it('paints nothing until an async checker answers, then re-runs on its own', async () => {
		const script = scriptedChecker(['one'], { async: true });
		const h = harness('one tow\n\none tow\n', script.checker);
		expect(h.marks([0])).toEqual([]);
		expect(script.check).toHaveBeenCalledTimes(2);
		script.answerAll();
		await tick();
		await tick();
		expect(h.marks([0])).toEqual([[4, 7, SPELL_MARK_CLASS]]);
		expect(h.marks([1])).toEqual([[4, 7, SPELL_MARK_CLASS]]);
		expect(script.check).toHaveBeenCalledTimes(2);
	});

	it('skips the word the caret is typing in, until the caret leaves it', async () => {
		const { checker } = scriptedChecker(['the']);
		const h = harness('the catt\n', checker);
		expect(h.marks([0])).toEqual([[4, 8, SPELL_MARK_CLASS]]);
		h.caretAt([0], 8);
		h.events.emit('edit', { op: 'input', path: [0], detail: undefined, timestamp: 0 });
		h.engine.notifyEdit();
		expect(h.marks([0])).toEqual([]);
		// The caret moves on (a space, an arrow key): the word is done and shows.
		h.caretAt([0], 9);
		h.events.emit('selectionChange', {
			anchor: { path: [0], offset: 9 },
			focus: { path: [0], offset: 9 }
		});
		await tick();
		await tick();
		expect(h.marks([0])).toEqual([[4, 8, SPELL_MARK_CLASS]]);
	});

	it('reads only the mounted top-level blocks, and again when the window moves', async () => {
		const { checker } = scriptedChecker([]);
		const h = harness('aaa\n\nbbb\n\nccc\n', checker, { mountedRange: { start: 1, end: 2 } });
		expect(h.marks([0])).toEqual([]);
		expect(h.marks([1])).toEqual([[0, 3, SPELL_MARK_CLASS]]);
		h.setMountedRange(null);
		await tick();
		await tick();
		expect(h.marks([0])).toEqual([[0, 3, SPELL_MARK_CLASS]]);
		expect(h.marks([2])).toEqual([[0, 3, SPELL_MARK_CLASS]]);
	});

	it('registers its source only while the mode is on', () => {
		const { checker } = scriptedChecker([]);
		const h = harness('aaa\n', checker, { mode: 'native' });
		expect(h.engine.sourceCount).toBe(0);
		h.state.setMode('on');
		expect(h.engine.sourceCount).toBe(1);
		expect(h.marks([0])).toEqual([[0, 3, SPELL_MARK_CLASS]]);
		h.state.setMode('off');
		expect(h.engine.sourceCount).toBe(0);
		expect(h.marks([0])).toEqual([]);
	});

	it('a checker that throws is reported once, and the word counts as spelled right', () => {
		const checker: SpellChecker = {
			check: () => {
				throw new Error('no dictionary');
			},
			suggest: () => []
		};
		const h = harness('aaa\n', checker);
		expect(h.marks([0])).toEqual([]);
		expect(h.onError).toHaveBeenCalledTimes(1);
	});
});

describe('createSpellState: the reads and writes the menus make', () => {
	it('names the misspelled word at an offset, both bounds included, and nothing else', () => {
		const { checker } = scriptedChecker(['the']);
		const h = harness('the catt\n\n```\ncatt\n```\n', checker);
		expect(h.state.misspellingAt([0], 4)).toEqual({ path: [0], start: 4, end: 8, word: 'catt' });
		expect(h.state.misspellingAt([0], 8)?.word).toBe('catt');
		expect(h.state.misspellingAt([0], 1)).toBeNull();
		expect(h.state.misspellingAt([1], 1)).toBeNull();
	});

	it('replaces the word as one splice with the caret after it', async () => {
		const { checker } = scriptedChecker(['the']);
		const h = harness('the catt\n', checker);
		const target = h.state.misspellingAt([0], 5)!;
		await h.state.replace(target, 'cat');
		expect(h.replaceRange).toHaveBeenCalledWith([0], 4, 8, 'cat', 7);
	});

	it('asks for suggestions once per word, and peeks at what has arrived', async () => {
		const script = scriptedChecker(['the']);
		const h = harness('the catt\n', script.checker);
		expect(h.state.peekSuggestions('catt')).toBeNull();
		expect(await h.state.suggestionsFor('catt')).toEqual(['att']);
		expect(h.state.peekSuggestions('catt')).toEqual(['att']);
		expect(script.suggest).toHaveBeenCalledTimes(1);
	});

	it('adding a word hands it to the checker and lifts its underline in every casing', async () => {
		const script = scriptedChecker(['the']);
		const h = harness('the catt Catt\n', script.checker);
		expect(h.marks([0]).length).toBe(2);
		expect(h.state.canAddWord).toBe(true);
		await h.state.addWord('catt');
		expect(script.addWord).toHaveBeenCalledWith('catt');
		await tick();
		await tick();
		// `Catt` is asked again too; the scripted list knows `catt` only, so it stays underlined.
		expect(h.marks([0])).toEqual([[9, 13, SPELL_MARK_CLASS]]);
	});

	it('a checker without addWord offers no add, and a missing checker underlines nothing', () => {
		const { checker } = scriptedChecker(['the'], { addWord: false });
		expect(harness('x\n', checker).state.canAddWord).toBe(false);
		const none = harness('aaa\n', null);
		expect(none.engine.sourceCount).toBe(0);
		expect(none.state.misspellingAt([0], 1)).toBeNull();
	});
});
