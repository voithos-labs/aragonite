// @vitest-environment jsdom
// Every route that rewrites a range in a mounted code block writes one span: the range where the
// mode paints the fence lines, its body part where it hides them, and nothing without a body part.
// Miss-analysis: each route kept its own copy of the span and its own tests, so no row ran one
// shape down every route.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { codePasteSurface } from '$lib/components/blocks/code/code-paste-surface';
import type { PresentationMode } from '$lib/presentation-mode';
import { ensurePasteSurface } from '$lib/test/support/paste-surface';
import { settleEditor } from '$lib/test/harness/settle';
import { mountCode, type MountedCode } from './mount-code';

// display "```js\nconst x = 1\n```": opener text [0,5) · info string [3,5) · body [6,17) · closer
// text [18,21).
const DISPLAY = '```js\nconst x = 1\n```';

type Span = [number, number];

interface Shape {
	name: string;
	range: Span;
	/** The span written where the fence lines are hidden; null writes nothing. */
	hidden: Span | null;
}

const SHAPES: Shape[] = [
	{ name: 'inside the body', range: [7, 12], hidden: [7, 12] },
	{ name: 'from the opener into the body', range: [2, 10], hidden: [6, 10] },
	{ name: 'from the body into the closer', range: [12, 20], hidden: [12, 17] },
	{ name: 'over the whole block', range: [0, 21], hidden: [6, 17] },
	{ name: 'over the closer alone', range: [18, 21], hidden: null },
	{ name: 'over the opener marker run', range: [0, 3], hidden: null },
	{ name: "over the body's line ending", range: [17, 18], hidden: null }
];

let mounted: MountedCode;

function dispatch(e: Event): Event {
	mounted.el.dispatchEvent(e);
	return e;
}

function input(inputType: string, data?: string): Event {
	return dispatch(
		new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
	);
}

function clipboard(type: 'cut' | 'paste', text = ''): Event {
	const data = new Map([['text/plain', text]]);
	const e = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: {
			getData: (format: string) => data.get(format) ?? '',
			setData: (format: string, value: string) => data.set(format, value),
			files: [],
			items: [],
			types: ['text/plain']
		}
	});
	return dispatch(e);
}

interface Route {
	name: string;
	/** Runs the gesture over the current selection, returning its event where it has one. */
	act(): Event | null;
	/** The bytes the route writes over the span it was given, and how far past the span's start
	 *  it leaves the caret. */
	write(spanned: string): string;
	caret: number;
	/** Where the fence lines are shown the browser applies the gesture, so the block writes none. */
	browserWhereShown: boolean;
}

const ROUTES: Route[] = [
	{
		name: 'Backspace',
		act: () => input('deleteContentBackward'),
		write: () => '',
		caret: 0,
		browserWhereShown: true
	},
	{
		name: 'Delete',
		act: () => input('deleteContentForward'),
		write: () => '',
		caret: 0,
		browserWhereShown: true
	},
	{
		name: 'a typed character',
		act: () => input('insertText', 'Z'),
		write: () => 'Z',
		caret: 1,
		browserWhereShown: true
	},
	{
		name: 'an IME composition',
		act: () => dispatch(new CompositionEvent('compositionstart', { bubbles: true })),
		write: () => '',
		caret: 0,
		browserWhereShown: true
	},
	{
		name: 'a typed bracket',
		act: () => input('insertText', '('),
		write: (spanned) => `(${spanned})`,
		caret: 1,
		browserWhereShown: false
	},
	{
		name: 'cut',
		act: () => clipboard('cut'),
		write: () => '',
		caret: 0,
		browserWhereShown: false
	},
	{
		name: 'paste',
		act: () => clipboard('paste', 'Y'),
		write: () => 'Y',
		caret: 1,
		browserWhereShown: false
	},
	{
		// Enter, a soft break and every command over a selection remove it through this first.
		name: 'a command over the selection',
		act: () => {
			mounted.instance.afterSelectionRemoved(() => true);
			return null;
		},
		write: () => '',
		caret: 0,
		browserWhereShown: false
	}
];

function select([start, end]: Span): void {
	const range = createRangeAtDomTextOffsets(
		mounted.el,
		asDomTextOffset(start),
		asDomTextOffset(end)
	);
	mounted.el.focus();
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range!);
}

/** The first write's displayed text and caret, without the trailing line ending reattached. */
function firstWrite(): { text: string; caret: number } | null {
	const [call] = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
	return call ? { text: (call[1] as string).replace(/\n$/, ''), caret: call[4] as number } : null;
}

beforeAll(() => ensurePasteSurface(codePasteSurface));
afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

const MODES: { label: string; mode: PresentationMode; shown: boolean }[] = [
	{ label: 'shown', mode: 'source', shown: true },
	{ label: 'hidden', mode: 'live', shown: false }
];

describe.each(MODES)('code block write routes, fence lines $label', ({ mode, shown }) => {
	for (const route of ROUTES) {
		it.each(SHAPES)(`${route.name} over a range $name`, async ({ range, hidden }) => {
			mounted = mountCode(`${DISPLAY}\n`, { policies: { presentationMode: () => mode } });
			select(range);
			const e = route.act();
			await settleEditor();

			const span = shown ? range : hidden;
			if (shown && route.browserWhereShown) {
				expect(e?.defaultPrevented).toBe(false);
				expect(firstWrite()).toBeNull();
			} else if (span === null) {
				expect(firstWrite()).toBeNull();
			} else {
				const [start, end] = span;
				const written = route.write(DISPLAY.slice(start, end));
				expect(firstWrite()).toEqual({
					text: DISPLAY.slice(0, start) + written + DISPLAY.slice(end),
					caret: start + route.caret
				});
			}
		});
	}
});
