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
import type { SelectionEndpoint } from '$lib/selection/primitives';
import { recordingFocus } from '$lib/testing/headless-actions';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import {
	makeBlockListState,
	makeNestedActionsDeps,
	makeTopHarness,
	type TopHarness
} from '../harness/editor-actions';
import { settleEditor } from '../harness/settle';
import { registerChromePluginsForTests } from '../selection/chrome-plugins';
import { makeBeforeInputEvent, makeHandlers } from '../selection/cross-block/typed-char-env';

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

interface Env {
	h: TopHarness;
	/** Every block path a caret was put in: a commit's landing, or the range dispatch's focus. */
	placed: number[][];
}

function editor(source: string): Env {
	const h = makeTopHarness(source);
	// Every container is mounted, as the editor's window holds them, so each has a list state; a
	// state keeps its node once the commit takes it, as an unmounting component does.
	const mount = (path: number[]): void => {
		const node = blockNodeAt(h.deps.doc, path);
		node?.children?.forEach((_, i) => mount([...path, i]));
		if (node?.children) makeBlockListState(() => blockNodeAt(h.deps.doc, path) ?? node);
	};
	h.deps.doc.children.forEach((_, i) => mount([i]));
	return { h, placed: [] };
}

function rangeHandlers(env: Env) {
	const { h } = env;
	const handlerEnv = {
		doc: h.doc,
		deps: h.deps,
		events: h.events,
		selectionState: h.deps.selectionState,
		controller: h.controller,
		blockEdit: h.actions,
		caretMemory: h.deps.caretMemory
	};
	return makeHandlers(handlerEnv as never, [0], {
		getBlockElByPath: (path) => {
			env.placed.push(path.slice());
			return null;
		}
	});
}

function select(env: Env, anchor: SelectionEndpoint, focus: SelectionEndpoint): void {
	env.h.deps.selectionState.enterCrossBlock(anchor, focus);
}

async function rangeKey(env: Env, key: string): Promise<void> {
	await rangeHandlers(env).handleKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }));
}

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

const whole = (path: number[]): SelectionEndpoint => ({ path, wholeBlock: true });
const at = (path: number[], offset: number): SelectionEndpoint => ({ path, offset });
const cell = (path: number[], offset: number): SelectionEndpoint => ({
	path,
	offset,
	cellCoordinate: true
});

interface Row {
	source: string;
	drive: (env: Env) => Promise<unknown> | void;
	bytes: string;
	/** Where the caret goes: `[0]` for the empty paragraph; none for a replace, which lands nothing. */
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
	'a focused quoted rule, Backspace through the quote': {
		source: '> ---\n',
		drive: (env) => focusedRuleKey(nested(env, 0), 'Backspace'),
		bytes: '\n',
		placed: [[0]]
	},
	'the only block replaced by nothing': {
		source: 'a\n',
		drive: (env) => env.h.actions.replaceBlock(0, []),
		bytes: '\n',
		placed: []
	},
	'a quote and the paragraph below held whole, Backspace': {
		source: '> ---\n\npara\n',
		drive: async (env) => {
			select(env, whole([0, 0]), at([1], 4));
			await rangeKey(env, 'Backspace');
		},
		bytes: '\n',
		placed: [[0]]
	},
	'a quote’s only child replaced by nothing': {
		source: '> a\n',
		drive: (env) => nested(env, 0).replaceBlock(0, []),
		bytes: '\n',
		placed: []
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

function paths(env: Env): number[][] {
	return [...env.h.landings.map((l) => [...l.leafPath]), ...env.placed];
}

function lockstep(doc: Document, ids: string[]): void {
	expect(ids).toHaveLength(doc.children.length);
}

describe('removing the last block leaves the document one empty paragraph', () => {
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
		expect(env.h.deps.doc.children.every((c) => !c.children)).toBe(true);
		lockstep(env.h.deps.doc, env.h.getBlockIds());
		expect(paths(env)).toEqual(row.placed);

		await createHistoryActions(env.h.deps, env.h.controller).requestUndo();
		await settleEditor();
		expect(serialize(env.h.deps.doc)).toBe(row.source);
		lockstep(env.h.deps.doc, env.h.getBlockIds());
	});
});
