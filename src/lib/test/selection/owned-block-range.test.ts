// @vitest-environment jsdom
// A finger's range inside one block is the editor's: painted, typed over, deleted, copied and
// formatted through the routes a range across blocks takes, while any other route leaves it alone.
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { fingerPress, type FingerPress } from '#lib/selection/pointer-gesture.js';
import { crossBlockClipboardArm } from '#lib/selection/cross-block/clipboard.js';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '#lib/selection/cross-block/format-range.js';
import { classifyBlockForSelection, type SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangePaint } from '#lib/selection/range-bytes.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import type { CrossBlockHandlers } from '#lib/selection/cross-block/dispatch.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { writtenBelow } from '#lib/test/harness/settle-funnel.js';
import { takeDevWarns } from '../support/warn-gate';
import { freshBytes } from '#lib/test/harness/copied-text.js';
import { rangeHandlers, rangeKey, rangeKeyEnv } from './cross-block/range-key-env';
import { makeBeforeInputEvent, makePasteEvent } from './cross-block/typed-char-env';
import { measured } from '#lib/tree-operations/top-level-starts.js';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const finger = (): FingerPress => fingerPress({ pointerType: 'touch', pointerId: 1 })!;
const WORD = { anchor: at([0], 6), focus: at([0], 11) };

describe('the state a finger range inside one block leaves', () => {
	it('owns and paints a finger range, and still refuses the same pair from any other route', () => {
		const owned = createSelectionState();
		owned.ownBlockRange(WORD.anchor, WORD.focus, finger());
		expect([owned.ownsRange, owned.isCustomRendered]).toEqual([true, true]);
		expect([owned.start, owned.end]).toEqual([at([0], 6), at([0], 11)]);

		const other = createSelectionState();
		other.enterCrossBlock(WORD.anchor, WORD.focus);
		expect(other.ownsRange).toBe(false);
	});

	it('G1.170: a range inside one block taken without a finger press fires the dev check', () => {
		const selection = createSelectionState();
		selection.ownBlockRange(WORD.anchor, WORD.focus, { pointerId: 1 } as unknown as FingerPress);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:owned-range-from-finger']);
	});

	it('a mouse or a pen makes no finger press', () => {
		expect(fingerPress({ pointerType: 'mouse', pointerId: 1 })).toBeNull();
		expect(fingerPress({ pointerType: 'pen', pointerId: 1 })).toBeNull();
	});

	it('its block paints the range as its own, one block', () => {
		const doc = parse('hello world\n\nnext\n');
		const coverage = rangeCoverage(doc, coverRange(doc, WORD.anchor, WORD.focus));
		const paint = rangePaint(doc, coverage, documentLayout(measured(doc)));
		expect(classifyBlockForSelection([0], paint)).toBe('single-block');
		expect(classifyBlockForSelection([1], paint)).toBe('outside');
	});
});

describe('what acts on a finger range inside one block', () => {
	function owned(source: string) {
		const env = rangeKeyEnv(source);
		env.h.deps.selectionState.ownBlockRange(WORD.anchor, WORD.focus, finger());
		return env;
	}

	it('a typed letter replaces it once', async () => {
		const env = owned('hello world\n\nnext\n');
		expect(await rangeHandlers(env).handleBeforeInput(makeBeforeInputEvent('X'))).toBe(true);
		expect(serialize(env.h.deps.doc)).toBe('hello X\n\nnext\n');
	});

	it('Backspace deletes it and nothing past it', async () => {
		const env = owned('hello world\n\nnext\n');
		await rangeKey(env, 'Backspace');
		expect(serialize(env.h.deps.doc)).toBe('hello \n\nnext\n');
	});

	it('a copy takes its text', () => {
		const selection = createSelectionState();
		selection.ownBlockRange(WORD.anchor, WORD.focus, finger());
		const doc = parse('hello world\n\nnext\n');
		const crossBlock = {
			reading: fixtureReading(),
			bytes: freshBytes(() => doc)
		} as unknown as CrossBlockHandlers;
		const arm = crossBlockClipboardArm({ selection, getDoc: () => doc, crossBlock });
		expect(arm.copy()?.write.text).toBe('world');
	});

	// Miss-analysis: every finger range typed over sat in a paragraph, which keeps a removal's
	// edge space; a cell stores none, so a removal and then an insert lost it.
	it.each([
		['a typed letter', 'x', '| x pie | berry |'],
		['a typed pipe', '|', '| \\| pie | berry |'],
		['a pasted pipe', { paste: 'a|b' }, '| a\\|b pie | berry |']
	] as const)('%s over a word in a cell keeps the space after it', async (_, text, row) => {
		const env = rangeKeyEnv('| apple pie | berry |\n| --- | --- |\n');
		const word = { anchor: at([0, 0, 0], 0), focus: at([0, 0, 0], 5) };
		env.h.deps.selectionState.ownBlockRange(word.anchor, word.focus, finger());
		const handlers = rangeHandlers(env);
		const took =
			typeof text === 'string'
				? await handlers.handleBeforeInput(makeBeforeInputEvent(text))
				: await handlers.handlePaste(makePasteEvent(text.paste));
		expect(took).toBe(true);
		expect(serialize(env.h.deps.doc)).toBe(`${row}\n| --- | --- |\n`);
	});

	it('a format toggle wraps it alone', () => {
		const doc = parse('hello world\n\nnext\n');
		const plan = planCrossBlockFormat(
			doc,
			coverRange(doc, WORD.anchor, WORD.focus),
			'strong',
			fixtureReading()
		);
		expect(plan).not.toBeNull();
		writtenBelow(
			doc,
			(scope) => applyCrossBlockFormat(scope, plan!),
			defaultGrammarView,
			createSharingState()
		);
		expect(serialize(doc)).toBe('hello **world**\n\nnext\n');
	});
});
