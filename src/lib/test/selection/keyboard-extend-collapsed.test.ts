// @vitest-environment jsdom
// Extending a selection past a closed details stops on its title row, the only part a caret can
// reach, and never names a hidden body leaf; select-all still covers that body.
// Miss-analysis: GH #562; every extension test walked open containers, never a hidden body.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	extendFocusToDocEdge,
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	selectWholeDocument
} from '../../selection/keyboard-extend';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { registerChromePluginsForTests } from './chrome-plugins';
import { stateAt, el } from './extend-walk-env';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const OPEN_AROUND_CLOSED =
	'<details open>\n<summary>Outer</summary>\n\nBody\n\n' + CLOSED + '\n</details>\n';

// [0] Above, [1] the closed details ([1,0] its title row "Sum", [1,1] the hidden "Hidden"), [2] Below.
const SANDWICH = 'Above\n\n' + CLOSED + '\nBelow\n';

beforeEach(registerChromePluginsForTests);

describe('extension past a closed details', () => {
	it('Shift+ArrowUp from below stops on the title row start', () => {
		const doc = parse(SANDWICH);
		const s = stateAt(doc, [2]);
		expect(
			extendFocusToPreviousBlock(s, testCaretWriter, doc, defaultGrammarView, el(), [2], 'start')
		).toBe(true);
		expect(s.focus).toEqual({ path: [1, 0], offset: 0 });
	});

	it('Shift+ArrowLeft from below stops on the title row end', () => {
		const doc = parse(SANDWICH);
		const s = stateAt(doc, [2]);
		expect(
			extendFocusToPreviousBlock(s, testCaretWriter, doc, defaultGrammarView, el(), [2], 'end')
		).toBe(true);
		expect(s.focus).toEqual({ path: [1, 0], offset: 3 });
	});

	it('Shift+ArrowDown from the title row steps past the hidden body', () => {
		const doc = parse(SANDWICH);
		for (const axis of ['vertical', 'horizontal'] as const) {
			const s = stateAt(doc, [1, 0]);
			expect(
				extendFocusToNextBlock(s, testCaretWriter, doc, defaultGrammarView, el(), [1, 0], axis)
			).toBe(true);
			expect(s.focus, axis).toEqual({ path: [2], offset: 0 });
		}
	});

	it('Mod+Shift+End into a document ending in a closed details stops on its title row', () => {
		const doc = parse('Above\n\n' + CLOSED);
		const s = stateAt(doc, [0]);
		expect(
			extendFocusToDocEdge(s, testCaretWriter, doc, defaultGrammarView, el(), [0], 'end')
		).toBe(true);
		expect(s.focus).toEqual({ path: [1, 0], offset: 3 });
	});

	it('a closed details nested last in an open one stops on the inner title row', () => {
		const doc = parse(OPEN_AROUND_CLOSED + '\nBelow\n');
		expect(doc.children[0].children?.[2]?.kind).toBe('details');
		const s = stateAt(doc, [1]);
		expect(
			extendFocusToPreviousBlock(s, testCaretWriter, doc, defaultGrammarView, el(), [1], 'start')
		).toBe(true);
		expect(s.focus).toEqual({ path: [0, 2, 0], offset: 0 });
	});
});

describe('select-all over a closed details', () => {
	it('the second Ctrl+A still ends inside the hidden body, so a delete takes it', () => {
		const doc = parse('Above\n\n' + CLOSED);
		const s = createSelectionState({ getDoc: () => doc });
		expect(selectWholeDocument(s, testCaretWriter, doc)).toBe(true);
		expect(s.focus).toEqual({ path: [1, 1], offset: 6 });
	});
});
