// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A mode that hides a block's own markers makes raw 0 unreachable, so the block-exit branches
// must fire at the bounds a caret can actually reach. The extenders and `moveFocus` are spied on
// to observe the decision without DOM geometry.
// Miss-analysis: the bounds came from the kind's declared content range, which a paragraph and a
// fenced code block both declare as the whole raw, so a fixture that never rendered could answer
// for them, and the two kinds whose runs carry no data attribute went untested.
vi.mock('../../selection/keyboard-extend', () => ({
	extendFocusToNextBlock: vi.fn(),
	extendFocusToPreviousBlock: vi.fn(),
	scrollFocusBlockIntoView: vi.fn()
}));

import { handleSharedKeydown, type SharedKeydownContext } from '../../selection/shared-keydown';
import { extendFocusToPreviousBlock } from '../../selection/keyboard-extend';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';
import { createTextRender } from '../../components/blocks/text/text-render';
import { renderCodeBlock } from '../../components/blocks/code/code-renderer';
import { makeRenderHarness } from '$lib/test/harness/text-render';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { createCaretMemory } from '$lib/cursor/caret-memory';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';

const toPrev = vi.mocked(extendFocusToPreviousBlock);

interface Env {
	ctx: SharedKeydownContext;
	moveFocus: ReturnType<typeof vi.fn>;
}

/** The block's own renderer paints the fixture: the bounds read the DOM, so a hand-built tree
 *  would answer for a document that never rendered. */
function render(node: CstNode): HTMLElement {
	const { el, deps } = makeRenderHarness(node, { mode: 'live' });
	if (node.kind === 'fencedCode') el.replaceChildren(renderCodeBlock(node, everyInstalledPlugin));
	else createTextRender(deps).render();
	return el;
}

function makeEnv(source: string, offset: number | null, mode?: string): Env {
	const doc = parse(source);
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const el = render(doc.children[0]);
	root.appendChild(el);
	document.body.replaceChildren(root);
	const moveFocus = vi.fn();
	return {
		moveFocus,
		// Cast the members this fixture does not stand up, never the whole context: a blanket cast
		// is what let a new required reader ship unanswered here.
		ctx: {
			// No plugins stood up here, so every installed one is active.
			activePlugins: everyInstalledPlugin,
			reading: fixtureReading(),
			getEl: () => el,
			getCursorOffset: () => offset,
			getFocusOffset: () => offset,
			getTextLen: () => source.replace(/\n+$/, '').length,
			getAmbientLength: () => 0,
			getMyPath: () => [0],
			getIndex: () => 1,
			crossBlock: {
				handleKeyDown: async () => false,
				handleBeforeInput: async () => false
			} as unknown as SharedKeydownContext['crossBlock'],
			selection: {
				resetSelectAllCount: () => {}
			} as unknown as SharedKeydownContext['selection'],
			caretMemory: createCaretMemory(),
			getKeybindingOverrides: () => normalizeKeybindingOverrides([]),
			history: {} as SharedKeydownContext['history'],
			focus: { moveFocus } as unknown as SharedKeydownContext['focus'],
			getDoc: () => doc,
			getBlockElByPath: () => null
		}
	};
}

const press = (key: string, shiftKey = false) =>
	new KeyboardEvent('keydown', { key, shiftKey, cancelable: true });

const FENCE = '```js\nconst x = 1;\n```\n';

beforeEach(() => toPrev.mockReset());

describe('block-exit branches read the reachable bounds', () => {
	// `## Title`: the `## ` is unpainted in live, so 3 is the first offset a caret can occupy
	// and ArrowLeft there is the block exit.
	it('ArrowLeft exits at a heading’s content start in live', async () => {
		const { ctx, moveFocus } = makeEnv('## Title\n', 3, 'live');
		const e = press('ArrowLeft');
		expect(await handleSharedKeydown(e, ctx)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(moveFocus).toHaveBeenCalledWith(0, 'end');
	});

	it('ArrowLeft mid-content still steps natively in live', async () => {
		const { ctx, moveFocus } = makeEnv('## Title\n', 4, 'live');
		expect(await handleSharedKeydown(press('ArrowLeft'), ctx)).toBe(false);
		expect(moveFocus).not.toHaveBeenCalled();
	});

	// Source paints the `## `, so raw 3 is an ordinary interior offset there.
	it('ArrowLeft at the same offset stays native in source mode', async () => {
		const { ctx, moveFocus } = makeEnv('## Title\n', 3);
		expect(await handleSharedKeydown(press('ArrowLeft'), ctx)).toBe(false);
		expect(moveFocus).not.toHaveBeenCalled();
	});

	// preview-block and preview-inline show the focused block's own prefix, so its bytes
	// stay reachable and the exit stays at raw 0.
	for (const mode of ['preview-block', 'preview-inline']) {
		it(`ArrowLeft at the content start stays native in ${mode}`, async () => {
			const { ctx } = makeEnv('## Title\n', 3, mode);
			expect(await handleSharedKeydown(press('ArrowLeft'), ctx)).toBe(false);
		});
	}

	it('a paragraph keeps raw 0 as its exit in live', async () => {
		const { ctx, moveFocus } = makeEnv('Title\n', 0, 'live');
		expect(await handleSharedKeydown(press('ArrowLeft'), ctx)).toBe(true);
		expect(moveFocus).toHaveBeenCalledWith(0, 'end');
	});

	// The kinds that declare no content range: a paragraph opening with a construct, and a
	// fenced code block, whose fence lines are the run nothing paints.
	it('ArrowLeft exits past a paragraph’s opening construct in live', async () => {
		const { ctx, moveFocus } = makeEnv('**Lead** in\n', 2, 'live');
		expect(await handleSharedKeydown(press('ArrowLeft'), ctx)).toBe(true);
		expect(moveFocus).toHaveBeenCalledWith(0, 'end');
	});

	it('ArrowLeft exits at a fenced code block’s body start in live', async () => {
		const { ctx, moveFocus } = makeEnv(FENCE, 6, 'live');
		expect(await handleSharedKeydown(press('ArrowLeft'), ctx)).toBe(true);
		expect(moveFocus).toHaveBeenCalledWith(0, 'end');
	});

	it('ArrowRight exits at a fenced code block’s body end in live', async () => {
		const { ctx, moveFocus } = makeEnv(FENCE, 18, 'live');
		expect(await handleSharedKeydown(press('ArrowRight'), ctx)).toBe(true);
		expect(moveFocus).toHaveBeenCalledWith(2, 'start');
	});

	it('the fence’s bounds are the whole raw in source mode', async () => {
		const { ctx } = makeEnv(FENCE, 6, undefined);
		expect(await handleSharedKeydown(press('ArrowLeft'), ctx)).toBe(false);
		const atEnd = makeEnv(FENCE, 18, undefined);
		expect(await handleSharedKeydown(press('ArrowRight'), atEnd.ctx)).toBe(false);
	});

	// A setext underline is a marker suffix: in live the last reachable offset is the
	// content end, and ArrowRight there exits rather than stepping into unpainted bytes.
	it('ArrowRight exits at a setext heading’s content end in live', async () => {
		const { ctx, moveFocus } = makeEnv('Title\n===\n', 5, 'live');
		const e = press('ArrowRight');
		expect(await handleSharedKeydown(e, ctx)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(moveFocus).toHaveBeenCalledWith(2, 'start');
	});

	it('ArrowRight at the same offset stays native in source mode', async () => {
		const { ctx } = makeEnv('Title\n===\n', 5);
		expect(await handleSharedKeydown(press('ArrowRight'), ctx)).toBe(false);
	});

	it('Shift+ArrowLeft extends out of the block from the content start in live', async () => {
		const { ctx } = makeEnv('## Title\n', 3, 'live');
		expect(await handleSharedKeydown(press('ArrowLeft', true), ctx)).toBe(true);
		expect(toPrev).toHaveBeenCalledTimes(1);
	});
});

describe('the keydown entry point notes the arrival', () => {
	// A horizontal step stops on the side it came from (live-mode.md § 4.2): Right records the
	// near side, Left the far one, so the byte typed next lands where the caret meant.
	it('a forward arrow records the run’s near side, Home the construct-relative outside', async () => {
		const { ctx } = makeEnv('Title\n', 2, 'live');
		await handleSharedKeydown(press('ArrowRight'), ctx);
		expect(ctx.caretMemory.side()).toBe('near');
		await handleSharedKeydown(press('ArrowLeft'), ctx);
		expect(ctx.caretMemory.side()).toBe('far');
		await handleSharedKeydown(press('Home'), ctx);
		expect(ctx.caretMemory.side()).toBe('outside');
	});

	// The shared handler reads the chord through the block's keymap before the memory sees it:
	// the default reorder chord moves the block, so the caret's memory stays for the move's commit.
	it('the reorder chord leaves the side and the pending marks alone', async () => {
		const { ctx } = makeEnv('Title\n', 2, 'live');
		await handleSharedKeydown(press('Home'), ctx);
		ctx.caretMemory.pendingMarks.toggle('strong');
		const reorder = new KeyboardEvent('keydown', {
			key: 'ArrowUp',
			altKey: true,
			cancelable: true
		});
		await handleSharedKeydown(reorder, ctx);
		expect(ctx.caretMemory.side()).toBe('outside');
		expect([...(ctx.caretMemory.pendingMarks.get() ?? [])]).toEqual(['strong']);
	});
});
