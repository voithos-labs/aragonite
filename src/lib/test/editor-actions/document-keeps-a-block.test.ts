// @vitest-environment jsdom
// No structural commit leaves the document, or a container that must hold a child, with none:
// every route that can remove the last block is driven through its real entry and its commit.
// Miss-analysis: every whole-unit and whole-block delete test kept a second block beside the one
// it removed, so no route was ever asked what an emptied document or quote holds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockEditActions } from '$lib/action-contracts';
import type { Document } from '$lib/core/nodes';
import { serialize } from '$lib/core/serializer';
import { createCaretMemory } from '$lib/cursor/caret-memory';
import { handleWholeBlockKeys } from '$lib/editor-actions/container-block-component';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { recordingFocus } from '$lib/testing/headless-actions';
import {
	makeBlockListState,
	makeListContextAt,
	makeNestedActionsDeps
} from '../harness/editor-actions';
import { settleEditor } from '../harness/settle';
import { registerChromePluginsForTests } from '../selection/chrome-plugins';
import { makeBeforeInputEvent } from '../selection/cross-block/typed-char-env';
import {
	at,
	cell,
	placedPaths,
	rangeHandlers,
	rangeKey,
	rangeKeyEnv as editor,
	select,
	whole,
	type RangeKeyEnv as Env
} from '../selection/cross-block/range-key-env';

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

/** The nested action bundle of the container at top-level `index`, over the real root. */
function nested(env: Env, index: number): BlockEditActions {
	const getNode = () => env.h.deps.doc.children[index];
	return createStandardNestedActions(
		makeBlockListState(getNode),
		makeNestedActionsDeps({
			index,
			getNode,
			path: [index],
			parent: {
				blockEdit: env.h.actions,
				focus: recordingFocus(),
				containerEdit: createContainerEditActions(env.h.deps, env.h.controller)
			}
		})
	).blockEdit;
}

/** A key pressed on the focused rule at `index` of whichever list `blockEdit` edits. */
function focusedRuleKey(blockEdit: BlockEditActions, key: string, mods = {}): void {
	const e = { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods };
	handleWholeBlockKeys({ ...e, preventDefault: () => {} } as unknown as KeyboardEvent, {
		getIndex: () => 0,
		getRaw: () => '---\n',
		blockEdit,
		focus: recordingFocus(),
		isReading: () => false,
		caretMemory: createCaretMemory(),
		commandOf: () => null
	});
}

interface Row {
	source: string;
	drive: (env: Env) => Promise<unknown> | void;
	bytes: string;
	/** Where the caret goes: `[0]` for the empty paragraph; none for a top-level replace, which
	 *  lands nothing. */
	placed: number[][];
}

const ROWS: Record<string, Row> = {
	'a rule held whole, Backspace': {
		source: '---\n',
		drive: async (env) => {
			select(env, whole([0]), whole([0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a focused rule, Backspace': {
		source: '---\n',
		drive: (env) => focusedRuleKey(env.h.actions, 'Backspace'),
		bytes: '\n',
		placed: [[0]]
	},
	'a focused rule, Delete': {
		source: '---\n',
		drive: (env) => focusedRuleKey(env.h.actions, 'Delete'),
		bytes: '\n',
		placed: [[0]]
	},
	'a focused rule, cut': {
		source: '---\n',
		drive: (env) => focusedRuleKey(env.h.actions, 'x', { ctrlKey: true }),
		bytes: '\n',
		placed: [[0]]
	},
	'a quoted rule held whole, Backspace': {
		source: '> ---\n',
		drive: async (env) => {
			select(env, whole([0, 0]), whole([0, 0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a rule two quotes deep held whole, Backspace': {
		source: '> > ---\n',
		drive: async (env) => {
			select(env, whole([0, 0, 0]), whole([0, 0, 0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a list item holding only a rule, the rule held whole, Backspace': {
		source: '* ---\n',
		drive: async (env) => {
			select(env, whole([0, 0, 0]), whole([0, 0, 0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a quoted rule under a paragraph held whole, Backspace: the quote goes, the paragraph stays': {
		source: 'a\n\n> ---\n',
		drive: async (env) => {
			select(env, whole([1, 0]), whole([1, 0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: 'a\n',
		placed: [[0]]
	},
	'a focused quoted rule, Backspace through the quote': {
		source: '> ---\n',
		drive: (env) => focusedRuleKey(nested(env, 0), 'Backspace'),
		bytes: '\n',
		placed: [[0]]
	},
	'a list item holding only a nested list, its one item promoted: the emptied item goes': {
		source: '- - a\n',
		drive: async (env) => {
			const outer = makeListContextAt(env.h.deps, 0, {
				controller: env.h.controller,
				parentBlockEdit: env.h.actions
			});
			const nestedList = env.h.deps.doc.children[0].children![0].children![0];
			await outer.listContext.promoteNestedItem(0, nestedList, 0);
		},
		bytes: '- a\n',
		placed: [[0, 0, 0]]
	},
	'the only block replaced by nothing': {
		source: 'a\n',
		drive: (env) => env.h.actions.replaceBlock(0, []),
		bytes: '\n',
		placed: []
	},
	// A text endpoint keeps its slot, emptied or not; a rule held whole keeps none, so a container
	// the range holds whole goes with it.
	'a quoted rule and the paragraph below, Backspace: the quote goes': {
		source: '> ---\n\npara\n',
		drive: async (env) => {
			select(env, whole([0, 0]), at([1], 4));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a quoted rule and the paragraph below as select-all makes it, Backspace: the quote goes': {
		source: '> ---\n\npara\n',
		drive: async (env) => {
			select(env, at([0, 0], 0), at([1], 4));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'two quoted rules held whole, Backspace: both quotes go': {
		source: '> ---\n\n> ---\n',
		drive: async (env) => {
			select(env, whole([0, 0]), whole([1, 0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a quoted rule and a list item’s text, Backspace: the quote goes, the item keeps its slot': {
		source: '> ---\n\n- b\n',
		drive: async (env) => {
			select(env, whole([0, 0]), at([1, 0, 0], 1));
			await rangeKey(env, 'Backspace');
		},
		bytes: '- \n',
		placed: [[0, 0, 0]]
	},
	'quoted text and the paragraph below, Backspace: the start keeps its slot in the quote': {
		source: '> a\n\npara\n',
		drive: async (env) => {
			select(env, at([0, 0], 0), at([1], 4));
			await rangeKey(env, 'Backspace');
		},
		bytes: '>\n',
		placed: [[0, 0]]
	},
	'a quote’s only child replaced by nothing': {
		source: '> a\n',
		drive: (env) => nested(env, 0).replaceBlock(0, []),
		bytes: '\n',
		placed: [[0]]
	},
	'a sole table held whole, Backspace': {
		source: TABLE,
		drive: async (env) => {
			select(env, cell([0], 0), cell([0], 3));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a sole closed details held whole, Backspace': {
		source: CLOSED,
		drive: async (env) => {
			select(env, at([0, 0], 0), at([0, 1], 6));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'two closed details held whole, Backspace': {
		source: CLOSED + '\n' + CLOSED,
		drive: async (env) => {
			select(env, at([0, 0], 0), at([1, 1], 6));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'two closed details held whole, x typed over them': {
		source: CLOSED + '\n' + CLOSED,
		drive: async (env) => {
			select(env, at([0, 0], 0), at([1, 1], 6));
			await rangeHandlers(env).handleBeforeInput(makeBeforeInputEvent('x'));
		},
		bytes: 'x\n',
		placed: [[0]]
	},
	'a CRLF rule held whole, Backspace': {
		source: '---\r\n',
		drive: async (env) => {
			select(env, whole([0]), whole([0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\r\n',
		placed: [[0]]
	},
	'a CRLF table held whole, Backspace': {
		source: TABLE.replace(/\n/g, '\r\n'),
		drive: async (env) => {
			select(env, cell([0], 0), cell([0], 3));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\r\n',
		placed: [[0]]
	},
	'a rule with no final line break held whole, Backspace': {
		source: '---',
		drive: async (env) => {
			select(env, whole([0]), whole([0]));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a table with no final line break held whole, Backspace': {
		source: TABLE.slice(0, -1),
		drive: async (env) => {
			select(env, cell([0], 0), cell([0], 3));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	}
};

function lockstep(doc: Document, ids: string[]): void {
	expect(ids).toHaveLength(doc.children.length);
}

describe('the document keeps a block, and an emptied container goes', () => {
	beforeEach(() => {
		registerChromePluginsForTests();
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each(Object.entries(ROWS))('%s', async (_name, row) => {
		const env = editor(row.source);
		await row.drive(env);
		await settleEditor();

		expect(serialize(env.h.deps.doc)).toBe(row.bytes);
		lockstep(env.h.deps.doc, env.h.getBlockIds());
		expect(placedPaths(env)).toEqual(row.placed);

		await createHistoryActions(env.h.deps, env.h.controller).requestUndo();
		await settleEditor();
		expect(serialize(env.h.deps.doc)).toBe(row.source);
		lockstep(env.h.deps.doc, env.h.getBlockIds());
	});
});
