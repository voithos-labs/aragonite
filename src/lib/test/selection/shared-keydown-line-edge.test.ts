// @vitest-environment jsdom
// Miss-analysis: Home and End computed the editor's line edge on every press, a read of the
// whole block's layout, though only a widget can move the browser's landing off it; no row timed a
// long code block. The second row pins the reverse: a block that draws a widget still reads it.
import { describe, it, expect, vi } from 'vitest';
import { handleSharedKeydown, type SharedKeydownContext } from '../../selection/shared-keydown';
import { createCaretWriter } from '../../browser/caret-writer';
import { parse } from '../../core/parser';
import { createTextRender } from '../../components/blocks/text/text-render';
import { makeRenderHarness } from '#lib/test/harness/text-render.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { commandContext } from '#lib/test/harness/command-context.js';

async function homeIn(source: string) {
	const doc = parse(source);
	const { el, deps } = makeRenderHarness(doc.children[0], { mode: 'source' });
	createTextRender(deps).render();
	document.body.replaceChildren(el);
	// jsdom lays nothing out, and a block with no box leaves Home to the browser.
	el.getClientRects = () => [new DOMRect(0, 0, 200, 20)] as unknown as DOMRectList;
	const caretWriter = createCaretWriter(
		() => {},
		() => false
	);
	const move = vi.spyOn(caretWriter, 'moveCaretToLineEdge').mockReturnValue(true);
	const text = source.replace(/\n$/, '');
	const caret = text.length;
	const lineEdge = vi.fn(() => 0);
	const ctx = {
		caretWriter,
		caretLanding: { restore: async () => 'applied' as const, showSelectionEnd: async () => {} },
		commands: commandContext(),
		reading: fixtureReading(),
		scroll: { visibleBand: () => null, showRect: () => {} },
		getEl: () => el,
		getCursorOffset: () => caret,
		getFocusOffset: () => caret,
		getTextLen: () => text.length,
		getMyPath: () => [0],
		getIndex: () => 0,
		crossBlock: {
			handleKeyDown: async () => false
		} as unknown as SharedKeydownContext['crossBlock'],
		selection: { resetSelectAllCount: () => {} } as unknown as SharedKeydownContext['selection'],
		caretMemory: createCaretMemory(),
		history: {} as SharedKeydownContext['history'],
		focus: {} as SharedKeydownContext['focus'],
		getDoc: () => doc,
		unitContext: (at: number) => ({
			text,
			caret: at,
			bounds: { start: 0, end: text.length },
			lineEdge
		}),
		caretUnits: { beside: () => null, crossed: () => {} }
	} satisfies SharedKeydownContext;
	const e = new KeyboardEvent('keydown', { key: 'Home', cancelable: true });
	await handleSharedKeydown(e, ctx);
	return { lineEdge, moved: move.mock.calls.length > 0 };
}

describe('Home reads the editor’s line edge only where a widget can move the landing', () => {
	it('a block that draws no widget takes the browser’s line move and reads no layout', async () => {
		const run = await homeIn('alpha beta gamma\n');
		expect(run.moved).toBe(true);
		expect(run.lineEdge).not.toHaveBeenCalled();
	});

	it('a block that draws a picture still reads the editor’s edge', async () => {
		const run = await homeIn('alpha ![x](/a.png) gamma\n');
		expect(run.lineEdge).toHaveBeenCalled();
	});
});
