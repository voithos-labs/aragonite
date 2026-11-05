// The range-edit law cases both runs drive: the unit suite through jsdom's stand-in events, the
// clipboard spec through a real browser. Each row's `expected` is what its law says; a row failing
// today also pins `today`, and both runs compare against `today` while it stands, so the two runs
// agree byte for byte or one goes red. The fix that closes a row deletes its `today`.

export interface CasePoint {
	path: number[];
	offset: number;
}

export type CaseStep =
	| { do: 'copy' | 'cut'; route: 'key' | 'menu' }
	/** `text` pastes that clipboard; without it, what the last copy or cut wrote. */
	| { do: 'paste'; route: 'key' | 'menu' | 'insertMarkdown'; text?: string }
	| { do: 'paste plain'; text: string }
	| { do: 'type'; text: string; route: 'hardware key' | 'composition' }
	| { do: 'press'; key: 'Backspace' | 'Delete' | 'Enter' }
	| { do: 'undo' }
	/** Drags the selection and drops it at `at`. */
	| { do: 'drop'; at: CasePoint };

export interface CaseObserved {
	source: string;
	/** The `text/plain` the last copy or cut wrote. */
	clipboard?: string;
	/** The selection `getSelection()` reads at the end. */
	selection?: { anchor: CasePoint; focus: CasePoint };
}

export interface RangeLawCase {
	name: string;
	law: string;
	source: string;
	mode: 'source' | 'live';
	/** Where the range or caret goes before the first step. `setSelection` puts it through the
	 *  public method in both runs; otherwise the browser run clicks and shift-clicks it. */
	select: { anchor: CasePoint; focus: CasePoint; by?: 'setSelection' };
	steps: CaseStep[];
	expected: CaseObserved;
	/** What the editor does today, while it breaks the law; the issue the class is filed as. */
	today?: CaseObserved;
	issue?: string;
	/** Where one engine breaks the law differently from jsdom and Chromium, what it does. */
	todayIn?: Partial<Record<OtherEngine, CaseObserved>>;
	/** A row one run can't drive, and why. */
	only?: { run: 'browser' | 'chromium'; reason: string };
	/** An engine the browser run skips the row in, and why. */
	skipIn?: Partial<Record<OtherEngine, string>>;
}

export type OtherEngine = 'firefox' | 'webkit';

const caret = (path: number[], offset: number) => ({
	anchor: { path, offset },
	focus: { path, offset }
});
const range = (from: CasePoint, to: CasePoint) => ({ anchor: from, focus: to });

const DOC_815 =
	'alpha bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you set out for Ithaka\n> > hope your road is a long one,\n';
const DOC_816 = '- i0\n  - i1\n    - i2\n  - i3\n    - i4\n\n    p5\n';

export const RANGE_LAW_CASES: readonly RangeLawCase[] = [
	{
		name: 'a word copied, cut and pasted back inside a paragraph',
		law: 'L1 L2 L3',
		source: 'alpha bravo charlie\n',
		mode: 'source',
		select: range({ path: [0], offset: 6 }, { path: [0], offset: 11 }),
		steps: [
			{ do: 'copy', route: 'key' },
			{ do: 'cut', route: 'key' },
			{ do: 'paste', route: 'key' }
		],
		expected: { source: 'alpha bravo charlie\n', clipboard: 'bravo' }
	},
	{
		name: 'a cut through a live bold run, pasted back',
		law: 'L3',
		source: 'a **bold** c\n',
		mode: 'live',
		select: range({ path: [0], offset: 0 }, { path: [0], offset: 6 }),
		steps: [
			{ do: 'cut', route: 'key' },
			{ do: 'paste', route: 'key' }
		],
		expected: { source: 'a **bold** c\n' }
	},
	{
		name: 'a cut across two paragraphs, pasted back',
		law: 'L3',
		issue: '#818',
		source: 'alpha bravo\n\ncharlie delta\n',
		mode: 'source',
		select: range({ path: [0], offset: 6 }, { path: [1], offset: 8 }),
		steps: [
			{ do: 'cut', route: 'key' },
			{ do: 'paste', route: 'key' }
		],
		expected: { source: 'alpha bravo\n\ncharlie delta\n', clipboard: 'bravo\n\ncharlie ' },
		today: { source: 'alpha \n\nbravo\n\ncharlie \ndelta\n', clipboard: 'bravo\n\ncharlie ' }
	},
	{
		name: 'a copy from a paragraph into a nested quote',
		law: 'L10',
		issue: '#815',
		source: DOC_815,
		mode: 'source',
		select: range({ path: [0], offset: 6 }, { path: [1, 1, 0], offset: 7 }),
		steps: [{ do: 'copy', route: 'key' }],
		expected: {
			source: DOC_815,
			clipboard: 'bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you '
		},
		today: { source: DOC_815, clipboard: 'bravo charlie\nIthaka\nBy C. P. Cavafy\nAs you ' }
	},
	{
		name: 'a cut from one nested item into the next, pasted back',
		law: 'L3',
		issue: '#816',
		source: DOC_816,
		mode: 'source',
		select: range({ path: [0, 0, 1, 0, 1, 0, 0], offset: 1 }, { path: [0, 0, 1, 1, 0], offset: 1 }),
		steps: [
			{ do: 'cut', route: 'key' },
			{ do: 'paste', route: 'key' }
		],
		expected: { source: DOC_816 },
		today: { source: '- i0\n  - i1\n    - i\n    - 2\n    i\n    - 3\n  - - i4\n\n    p5\n' }
	},
	{
		name: 'a key typed over a range ending at a picture',
		law: 'L5',
		issue: '#817',
		source: 'alpha\n\nbeta\n\n![pic](p.png)\n',
		mode: 'source',
		select: range({ path: [0], offset: 5 }, { path: [2], offset: 13 }),
		steps: [{ do: 'type', text: 'Z', route: 'hardware key' }],
		expected: { source: 'alphaZ\n' },
		today: { source: 'alpha\n\nbeta\n\nZ![pic](p.png)\n' },
		todayIn: { firefox: { source: 'alpha\n\nbeta\n\n![pic](p.png)Z\n' } }
	},
	{
		name: 'Backspace over a range across paragraphs leaves what a cut leaves',
		law: 'L4',
		source: 'one\n\ntwo\n',
		mode: 'source',
		select: range({ path: [0], offset: 1 }, { path: [1], offset: 2 }),
		steps: [{ do: 'press', key: 'Backspace' }],
		expected: { source: 'oo\n' }
	},
	{
		name: 'the menu’s Cut over a range across paragraphs',
		law: 'L1',
		source: 'one\n\ntwo\n',
		mode: 'source',
		select: range({ path: [0], offset: 1 }, { path: [1], offset: 2 }),
		steps: [{ do: 'cut', route: 'menu' }],
		issue: '#820',
		expected: { source: 'oo\n', clipboard: 'ne\n\ntw' },
		today: { source: 'one\n\ntwo\n', clipboard: '' }
	},
	{
		name: 'blocks pasted by insertMarkdown in the middle of a paragraph',
		law: 'L9',
		issue: '#818',
		source: 'alpha bravo\n',
		mode: 'source',
		select: caret([0], 6),
		steps: [{ do: 'paste', route: 'insertMarkdown', text: 'one\n\ntwo' }],
		expected: { source: 'alpha one\n\ntwobravo\n' },
		today: { source: 'alpha \n\none\n\ntwo\nbravo\n' }
	},
	{
		name: 'Paste as plain text into a paragraph',
		law: 'L11',
		source: 'alpha\n',
		mode: 'source',
		select: caret([0], 5),
		steps: [{ do: 'paste plain', text: '# not *a* heading' }],
		expected: { source: 'alpha\\# not \\*a\\* heading\n' }
	},
	{
		name: 'Paste as plain text into a code block in a list item',
		law: 'L11',
		source: '- x\n\n  ```\n  code\n  ```\n',
		mode: 'source',
		select: caret([0, 0, 1], 8),
		steps: [{ do: 'paste plain', text: '# *y*' }],
		expected: { source: '- x\n\n  ```\n  code# *y*\n  ```\n' }
	},
	{
		name: 'an IME composition over a range across paragraphs',
		law: 'L5',
		source: 'abc\n\ndef\n',
		mode: 'source',
		select: range({ path: [0], offset: 1 }, { path: [1], offset: 2 }),
		steps: [{ do: 'type', text: 'x', route: 'composition' }],
		expected: { source: 'axf\n' },
		only: { run: 'chromium', reason: 'only Chromium drives a real IME, over CDP' }
	},
	{
		name: 'a cut across paragraphs of a CRLF document, pasted back',
		law: 'L3',
		issue: '#818',
		source: 'one\r\n\r\ntwo\r\n',
		mode: 'source',
		select: range({ path: [0], offset: 1 }, { path: [1], offset: 2 }),
		steps: [
			{ do: 'cut', route: 'key' },
			{ do: 'paste', route: 'key' }
		],
		expected: { source: 'one\r\n\r\ntwo\r\n' },
		today: { source: 'o\r\n\r\nne\r\n\r\ntw\r\no\r\n' }
	},
	{
		name: 'undo after a paste puts the caret where the paste began',
		law: 'L7',
		source: 'alpha\n',
		mode: 'source',
		select: caret([0], 2),
		steps: [{ do: 'paste', route: 'key', text: 'xyz' }, { do: 'undo' }],
		expected: { source: 'alpha\n', selection: caret([0], 2) },
		only: {
			run: 'browser',
			reason: 'jsdom’s undo restores no caret (its scroll never arrives); every browser does'
		}
	},
	{
		name: 'a range inside one live block, put by setSelection and read back',
		law: 'setSelection',
		source: 'a **bold** c\n',
		mode: 'live',
		select: { ...range({ path: [0], offset: 2 }, { path: [0], offset: 6 }), by: 'setSelection' },
		steps: [],
		expected: {
			source: 'a **bold** c\n',
			selection: range({ path: [0], offset: 2 }, { path: [0], offset: 6 })
		},
		only: {
			run: 'browser',
			reason: 'jsdom collapses it to the block’s start; every browser keeps it, so a jsdom note'
		}
	},
	{
		name: 'a word dragged to the end of the next paragraph',
		law: 'L6',
		source: 'alpha bravo\n\ncharlie\n',
		mode: 'source',
		select: range({ path: [0], offset: 6 }, { path: [0], offset: 11 }),
		steps: [{ do: 'drop', at: { path: [1], offset: 7 } }],
		expected: { source: 'alpha \n\ncharliebravo\n' },
		only: {
			run: 'browser',
			reason: 'jsdom lays nothing out, so a drop point has no block under it'
		},
		skipIn: {
			firefox:
				'Playwright’s drag in Firefox sends dragstart and dragover, which the editor accepts, and never the drop'
		}
	}
];
