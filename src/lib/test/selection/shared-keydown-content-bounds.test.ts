// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A mode that hides a block's own structural markers with no reveal makes raw 0 unreachable,
// so the block-exit arms must fire at the CONTENT bounds instead. Spy on the extenders and on
// moveFocus to observe the decision without DOM geometry.
// Miss-analysis: every shared-keydown test built a detached element with no presentation root
// and a paragraph fixture, where the content range IS [0, textLen] — the marker-bearing kinds
// the arms actually break on had no fixture.
vi.mock('../../selection/keyboard-extend', () => ({
	extendFocusToNextBlock: vi.fn(),
	extendFocusToPreviousBlock: vi.fn(),
	scrollFocusBlockIntoView: vi.fn()
}));

import { handleSharedKeydown, type SharedKeydownContext } from '../../selection/shared-keydown';
import { extendFocusToPreviousBlock } from '../../selection/keyboard-extend';
import { parse } from '../../core/parser';
import { createStickyColumnState } from '../../cursor/sticky-column';
import { createEdgeAffinityState } from '../../cursor/edge-affinity';

const toPrev = vi.mocked(extendFocusToPreviousBlock);

interface Env {
	ctx: SharedKeydownContext;
	moveFocus: ReturnType<typeof vi.fn>;
}

/** `source` renders into a block element under an optional presentation root. */
function makeEnv(source: string, offset: number | null, mode?: string): Env {
	const doc = parse(source);
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const el = document.createElement('div');
	root.appendChild(el);
	document.body.replaceChildren(root);
	const moveFocus = vi.fn();
	const textLen = source.replace(/\n+$/, '').length;
	return {
		moveFocus,
		ctx: {
			getEl: () => el,
			getCursorOffset: () => offset,
			getFocusOffset: () => offset,
			getTextLen: () => textLen,
			getMyPath: () => [0],
			getIndex: () => 1,
			crossBlock: { handleKeyDown: async () => false, handleBeforeInput: async () => false },
			selection: { resetSelectAllCount: () => {} },
			stickyColumn: createStickyColumnState(),
			edgeAffinity: createEdgeAffinityState(),
			history: {},
			focus: { moveFocus },
			getDoc: () => doc,
			getBlockElByPath: () => null
		} as unknown as SharedKeydownContext
	};
}

const press = (key: string, shiftKey = false) =>
	new KeyboardEvent('keydown', { key, shiftKey, cancelable: true });

beforeEach(() => toPrev.mockReset());

describe('block-exit arms read the content bounds', () => {
	// `## Title`: content [3, 8). The `## ` is unpainted in live, so 3 is the first offset a
	// caret can occupy and ArrowLeft there is the block exit.
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

	// preview-block and preview-inline reveal the focused block's own prefix, so its bytes
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

	// A setext underline is a structural SUFFIX: in live the last reachable offset is the
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

describe('the keydown door notes the arrival', () => {
	it('an arrow records the content side, Home the far side', async () => {
		const { ctx } = makeEnv('Title\n', 2, 'live');
		await handleSharedKeydown(press('ArrowRight'), ctx);
		expect(ctx.edgeAffinity.get()).toBe('inside');
		await handleSharedKeydown(press('Home'), ctx);
		expect(ctx.edgeAffinity.get()).toBe('outside');
	});
});
