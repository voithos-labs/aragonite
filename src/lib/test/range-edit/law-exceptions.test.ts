// @vitest-environment jsdom
// Each shape a law steps aside for, held to that shape: the law is silent on it, the core really
// answers otherwise there, and a wrong answer one step outside it still reds.
// Miss-analysis: two reviews found a law's exceptions wider than their rulings, and no test stood
// one step outside an exception.
// Laws 3 and 5 step aside for a live range only where a construct holds an end and the bytes it
// carries differ. The carried bytes alone skipped some 290 live ranges a seed that no construct
// holds (any range in a quote's or an item's two lines). Judged, those red 47 lines on four seeds,
// every one in a class `known-residue.ts` declares: a tab split beside a marker (25), an HTML block
// cut from its first byte (7), an item's text start (5), a container nested when pasted back (4), a
// marker that comes back (3), the spaces a cut leaves at a line's start (2), a setext re-read (1).

import { describe, expect, it } from 'vitest';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import { cutPasteBack, pasteAtCaret, plainPaste, replaceLaws, type Call } from './laws';
import { checkHost } from './test-host';

const marked = (text: string, mode: Mode = 'source') => ({
	source: text.replace(/[⟦⟧‸]/g, ''),
	mode,
	range: { from: text.indexOf('⟦'), to: text.indexOf('⟧') - 1 }
});
const isPaste = (gesture: Gesture) => typeof gesture === 'object' && 'paste' in gesture;
const paste = (text: string): Gesture => ({ paste: text, plain: false, holds: 'text' });

/** The core, and the core with every paste (`over`: only a paste over a range; `only`: in that
 *  mode alone) answered `wrong`. */
function calls(wrong: string, over = false, only?: Mode) {
	const host = checkHost();
	const real: Call = (source, range, gesture, mode) =>
		editRange(source, range, gesture, mode, host);
	const fake: Call = (source, range, gesture, mode) =>
		isPaste(gesture) && (!over || range.from < range.to) && (!only || mode === only)
			? { source: wrong, caret: { at: 0, holds: 'text' } }
			: real(source, range, gesture, mode);
	return { host, real, fake };
}

describe('law 3', () => {
	it('is silent on a cut from a heading’s text start that reads as a block alone', () => {
		const { host, real, fake } = calls('# rest\n');
		for (const shape of ['# ⟦> q⟧\n', '# ⟦> q⟧ rest\n']) {
			const declared = marked(shape);
			expect(cutPasteBack(fake, host, declared)).toEqual([]);
			const cut = real(declared.source, declared.range, 'cut', 'source')!;
			const at = { from: cut.caret.at, to: cut.caret.at };
			const back = real(cut.source, at, paste(cut.clipboard!), 'source')!;
			expect(back.source).not.toBe(declared.source);
		}
		const beside = marked('# a⟦> q⟧ rest\n');
		expect(cutPasteBack(real, host, beside)).toEqual([]);
		expect(cutPasteBack(fake, host, beside)).not.toEqual([]);
	});

	it('compares the paste back on the line an emptied heading gave way on', () => {
		const { host, real } = calls('');
		const cut = real('a\n# h\n---\n', { from: 4, to: 9 }, 'cut', 'source')!;
		expect(cut.source).toBe('a\n# \n');
		const input = { source: 'a\n# h\n---\n', mode: 'source' as const, range: { from: 4, to: 9 } };
		expect(cutPasteBack(real, host, input)).not.toEqual([]);
	});

	it('is silent on a live range a run holds an end of, and judges one in a quote’s two lines', () => {
		const { host, real, fake } = calls('zzz\n');
		expect(cutPasteBack(fake, host, marked('> a **b⟦o⟧ld** z\n> word\n', 'live'))).toEqual([]);
		const outside = marked('> x⟦ y⟧ z\n> word\n', 'live');
		expect(cutPasteBack(real, host, outside)).toEqual([]);
		expect(cutPasteBack(fake, host, outside)).not.toEqual([]);
	});

	// Miss-analysis: a `:::` container's opening line is its title row, no line of its own, so the
	// exception took a container cut whole for one left from its body, and no row stood beside it.
	it('is silent on a range from a fenced container’s body out past its closing line', () => {
		const { host, real, fake } = calls('zzz\n');
		for (const shape of [':::note\n⟦X\n:::⟧\n', ':::note\nX⟦\n:::\n\nafter⟧\n']) {
			const declared = marked(shape);
			expect(cutPasteBack(fake, host, declared)).toEqual([]);
			const cut = real(declared.source, declared.range, 'cut', 'source')!;
			const at = { from: cut.caret.at, to: cut.caret.at };
			const back = real(cut.source, at, paste(cut.clipboard!), 'source')!;
			expect(back.source).not.toBe(declared.source);
		}
		// Held whole from its first byte, plain text carries the container back.
		for (const whole of ['⟦:::note\nX\n:::\n⟧after\n', 'a\n\n⟦:::note\nX\n:::\n⟧\nb\n']) {
			expect(cutPasteBack(real, host, marked(whole))).toEqual([]);
			expect(cutPasteBack(fake, host, marked(whole))).not.toEqual([]);
		}
	});
});

describe('law 5', () => {
	const l5 = (lines: string[]) => lines.filter((line) => line.startsWith('L5'));

	it('is silent on a setext title’s whole text, whose cut leaves the underline a line', () => {
		const { host, real, fake } = calls('zzz\n', true);
		const declared = marked('⟦Title⟧\n===\n');
		expect(l5(replaceLaws(fake, host, declared, '> q'))).toEqual([]);
		const cut = real(declared.source, declared.range, 'cut', 'source')!;
		const at = { from: cut.caret.at, to: cut.caret.at };
		const then = real(cut.source, at, paste('> q'), 'source')!;
		const over = real(declared.source, declared.range, paste('> q'), 'source')!;
		expect(then.source).not.toBe(over.source);
		for (const beside of ['Ti⟦tl⟧e\n===\n', 'Ti⟦tle⟧\n===\n', '# ⟦Title⟧ #\n']) {
			expect(l5(replaceLaws(real, host, marked(beside), '> q'))).toEqual([]);
			expect(l5(replaceLaws(fake, host, marked(beside), '> q'))).not.toEqual([]);
		}
	});

	it('holds blocks over a heading’s whole text to the cut then the paste, live to source', () => {
		for (const mode of ['source', 'live'] as const) {
			const kept = calls('# \n\n> q\n', true, mode);
			const input = marked('# ⟦Title⟧\n', mode);
			expect(l5(replaceLaws(kept.real, kept.host, input, '> q'))).toEqual([]);
			expect(l5(replaceLaws(kept.fake, kept.host, input, '> q'))).not.toEqual([]);
		}
	});

	it('holds text over a block held whole in a quote, a blank line set over it', () => {
		const { host, real, fake } = calls('> a\n> x\n> zzz\n', true);
		const whole = marked('> a\n> ⟦***⟧\n> b\n');
		expect(real(whole.source, whole.range, paste('x'), 'source')!.source).toBe(
			'> a\n>\n> x\n>\n> b\n'
		);
		expect(l5(replaceLaws(real, host, whole, 'x'))).toEqual([]);
		expect(l5(replaceLaws(fake, host, whole, 'x'))).not.toEqual([]);
	});

	it('reads blocks pasted from a later line’s start as a cut over that line', () => {
		const fence = '```\ncode\n```\n';
		const { host, real, fake } = calls('> zzz\n>\n> ```\n> code\n> ```\n> > deep\n', true);
		const later = marked('> Ithaka\n> ⟦By C. P. Cavafy⟧\n> > deep\n');
		expect(l5(replaceLaws(real, host, later, fence))).toEqual([]);
		expect(l5(replaceLaws(fake, host, later, fence))).not.toEqual([]);
	});

	it('holds a live range in a quote’s two lines to the lines its clipboard brings', () => {
		const added = calls('> x one\n>\n> more\n>\n> two z\n> word\n', true);
		const outside = marked('> x⟦ y⟧ z\n> word\n', 'live');
		expect(l5(replaceLaws(added.real, added.host, outside, 'one\n\ntwo'))).toEqual([]);
		expect(l5(replaceLaws(added.fake, added.host, outside, 'one\n\ntwo'))).not.toEqual([]);
	});

	// Miss-analysis: no drawn range on the lane's seeds sat inside an autolink, so law 5 never met a
	// paste the core moves to the autolink's edge, outside the range.
	it('holds a paste over a range inside an autolink to the cut then the paste', () => {
		const { host, real, fake } = calls('zzz\n', true);
		const inside = marked('a <http://x⟦y⟧.z> w\n', 'live');
		expect(real(inside.source, inside.range, paste('one\n\ntwo'), 'live')!.source).toBe(
			'a <http://x.z>one\n\ntwo w\n'
		);
		expect(l5(replaceLaws(real, host, inside, 'one\n\ntwo'))).toEqual([]);
		expect(l5(replaceLaws(fake, host, inside, 'one\n\ntwo'))).not.toEqual([]);
		const beside = marked('a <http://xy.z> ⟦w⟧ v\n', 'live');
		expect(l5(replaceLaws(fake, host, beside, 'one\n\ntwo'))).not.toEqual([]);
	});

	// Miss-analysis: the allowance for a blank line over code asked only what stood under the line of
	// spaces, so it also passed one written inside the code where the spaces make the text a code line.
	it('lets text over a line of spaces above code keep a blank line, and none inside the code', () => {
		const { host, real } = calls('', true);
		const above = marked(' ⟦ ⟧\n    code\n');
		expect(real(above.source, above.range, paste('x'), 'source')!.source).toBe(' x\n\n    code\n');
		expect(l5(replaceLaws(real, host, above, 'x'))).toEqual([]);
		const inCode = marked('    ⟦ ⟧\n    code\n');
		expect(real(inCode.source, inCode.range, paste('x'), 'source')!.source).toBe(
			'    x\n    code\n'
		);
		expect(l5(replaceLaws(real, host, inCode, 'x'))).toEqual([]);
		const lined = calls('    x\n\n    code\n', true);
		expect(l5(replaceLaws(lined.fake, lined.host, inCode, 'x'))).not.toEqual([]);
	});
});

// Miss-analysis: the laws found the alert's own line by a byte inside it, which the end of a file
// with no last line break is not, so laws 9 and 11 redded the core's right answer there.
describe('laws 9 and 11 at an alert’s marker line with no body line under it', () => {
	const at = (text: string, pasted = 'x') => ({
		source: text.replace('‸', ''),
		mode: 'source' as const,
		at: text.indexOf('‸'),
		held: { holds: 'text' as const },
		text: pasted
	});

	it.each([
		['in a closed file', '> [!NOTE]‸\n', '> [!NOTE]\n> x\n', '> [!NOTE]x\n'],
		['at an open file’s end', '> [!NOTE]‸', '> [!NOTE]\n> x', '> [!NOTE]x']
	])('hold the paste to the body line a typed letter opens, %s', (_name, text, bytes, wrong) => {
		const { host, real } = calls('');
		const input = at(text);
		const caret = { from: input.at, to: input.at };
		expect(real(input.source, caret, paste('x'), 'source')!.source).toBe(bytes);
		expect(pasteAtCaret(real, host, input)).toEqual([]);
		expect(plainPaste(real, host, input)).toEqual([]);
		const onMarkerLine = calls(wrong);
		expect(pasteAtCaret(onMarkerLine.fake, onMarkerLine.host, input)).not.toEqual([]);
		expect(plainPaste(onMarkerLine.fake, onMarkerLine.host, input)).not.toEqual([]);
	});

	it('judge a caret over a body line by the byte it is given', () => {
		const { host, real, fake } = calls('zzz\n');
		const over = at('> [!NOTE]\n> ‸body\n');
		expect(pasteAtCaret(real, host, over)).toEqual([]);
		expect(pasteAtCaret(fake, host, over)).not.toEqual([]);
	});
});

describe('law 9 in a cell', () => {
	const TABLE = '| H‸0 | H1 |\n| --- | --- |\n| a | b |\n';
	const caret = (wrong: string) => {
		const { host, real, fake } = calls(wrong);
		const input = {
			source: TABLE.replace('‸', ''),
			mode: 'source' as const,
			at: TABLE.indexOf('‸'),
			held: { holds: 'text' as const },
			text: 'line one\nline two\n'
		};
		return { host, real, fake, input };
	};

	it('holds pasted lines to the cell’s one line', () => {
		const { host, real, input } = caret('');
		expect(pasteAtCaret(real, host, input)).toEqual([]);
		const got = real(input.source, { from: input.at, to: input.at }, paste(input.text), 'source')!;
		expect(got.source.split('\n').length).toBe(input.source.split('\n').length);
	});

	it('reds on a line added, and on a byte moved in another line', () => {
		const added = caret('| Hline one\nline two0 | H1 |\n| --- | --- |\n| a | b |\n');
		expect(pasteAtCaret(added.fake, added.host, added.input)).not.toEqual([]);
		const moved = caret('| Hline one line two0 | H1 |\n| --- | --- |\n| a | x |\n');
		expect(pasteAtCaret(moved.fake, moved.host, moved.input)).not.toEqual([]);
	});
});

describe('law 9 in a container with a write rule for its body', () => {
	const BODY = '<details>\n<summary>s</summary>\n\nab‸</details>\n\nmore\n\n</details>\n';
	const input = {
		source: BODY.replace('‸', ''),
		mode: 'source' as const,
		at: BODY.indexOf('‸'),
		held: { holds: 'text' as const },
		text: 'one\n\n'
	};

	it('holds a half left alone on its line to that rule, on that one line', () => {
		const escaped = BODY.replace('‸</details>', 'one\n\n&lt;/details>');
		const { host, real } = calls('');
		expect(pasteAtCaret(real, host, input)).toEqual([]);
		expect(
			real(input.source, { from: input.at, to: input.at }, paste(input.text), 'source')
		).toMatchObject({ source: escaped });
		const another = calls(escaped.replace('more', 'less'));
		expect(pasteAtCaret(another.fake, another.host, input)).not.toEqual([]);
		const unescaped = calls(BODY.replace('‸', 'one\n\n'));
		expect(pasteAtCaret(unescaped.fake, unescaped.host, input)).not.toEqual([]);
	});
});

// Miss-analysis: law 9 held the plain splice, which a pasted closing line satisfies by closing the
// container early, so fence growth turned off passed every law and only the mounted rows saw it.
describe('law 9 at a line that could close the container around the caret', () => {
	const BODY = ':::note\nbo‸dy\n:::\n\nAfter\n';
	const input = {
		source: BODY.replace('‸', ''),
		mode: 'source' as const,
		at: BODY.indexOf('‸'),
		held: { holds: 'text' as const },
		text: 'x\n:::\ny'
	};

	it('passes the grown fence and reds the bytes that close the container early', () => {
		const { host, real } = calls('');
		expect(pasteAtCaret(real, host, input)).toEqual([]);
		const got = real(input.source, { from: input.at, to: input.at }, paste(input.text), 'source');
		expect(got?.source).toMatch(/^::::note\n/);
		const spliced = calls(BODY.replace('‸', input.text));
		expect(pasteAtCaret(spliced.fake, spliced.host, input)).toEqual([
			expect.stringMatching(/^L9 a pasted line closed the \w+ around it/)
		]);
	});
});

// Miss-analysis: the live law took every caret whose carried bytes differ from its plain ones for
// a caret in a run, most of them in no construct, and passed one pasted paragraph unread.
describe('law 9 in live mode, outside its live shape', () => {
	const live = (text: string, pasted: string) => ({
		source: text.replace('‸', ''),
		mode: 'live' as const,
		at: text.indexOf('‸'),
		held: { holds: 'text' as const },
		text: pasted
	});

	it.each([
		['a caret no construct holds, in a quote’s two lines', '> x‸ y\n> word\n', 'one\ntwo'],
		['blocks pasted at that caret', '> x‸ y\n> word\n', '- q\n- r'],
		['one paragraph pasted inside a run', 'a **bo‸ld** z\n', 'x'],
		['a paragraph of two lines pasted inside a run', 'a **bo‸ld** z\n', 'line one\nline two']
	])('judges %s by its bytes', (_name, text, pasted) => {
		const { host, real, fake } = calls('zzz\n');
		expect(pasteAtCaret(real, host, live(text, pasted))).toEqual([]);
		expect(pasteAtCaret(fake, host, live(text, pasted))).not.toEqual([]);
	});
});

// Miss-analysis: law 9 at an open end was first written to take the closed file's answer for any
// clipboard, which passed text with no line ending that ended the file on a line break.
describe('law 9 at an open file’s end', () => {
	const at = (text: string, pasted: string) => ({
		source: text.replace('‸', ''),
		mode: 'source' as const,
		at: text.indexOf('‸'),
		held: { holds: 'text' as const },
		text: pasted
	});

	it('takes the closed file’s answer only under a clipboard that ends in a line ending', () => {
		const { host, real } = calls('');
		expect(pasteAtCaret(real, host, at('> a‸', 'x\n'))).toEqual([]);
		expect(real('> a', { from: 3, to: 3 }, paste('x\n'), 'source')).toMatchObject({
			source: '> ax\n>\n>\n'
		});
		expect(pasteAtCaret(real, host, at('a‸', 'x'))).toEqual([]);
		const closing = calls('ax\n');
		expect(pasteAtCaret(closing.fake, closing.host, at('a‸', 'x'))).not.toEqual([]);
	});
});

describe('law 5 at an open file’s end', () => {
	// Miss-analysis: the acceptance asked only where the range ends, so a paste of text with no line
	// ending could leave a stray one at the file's end and pass as Enter's line.
	it('steps aside for Enter’s line only under a clipboard that ends in a line ending', () => {
		const { host, real } = calls('');
		const stray: Call = (source, range, gesture, mode) => {
			const got = real(source, range, gesture, mode)!;
			return isPaste(gesture) && range.from < range.to
				? { ...got, source: got.source + '\n' }
				: got;
		};
		const open = marked('al⟦pha\n\nbeta⟧');
		expect(replaceLaws(real, host, open, 'x')).toEqual([]);
		expect(replaceLaws(real, host, open, 'x\n')).toEqual([]);
		expect(replaceLaws(stray, host, open, 'x')).not.toEqual([]);
	});
});

// Miss-analysis: law 9 expected no bytes for any paste in an item's text that opens with a line
// ending, and law 3 skipped every cut that left one, so only the mounted rows held that Enter.
describe('a clipboard’s leading line ending in an item’s text', () => {
	const at = (text: string, pasted: string) => ({
		source: text.replace('‸', ''),
		mode: 'source' as const,
		at: text.indexOf('‸'),
		held: { holds: 'text' as const },
		text: pasted
	});

	it.each([
		['mid-text', '- al‸pha\n- b\n', '\nx', '- al\n- xpha\n- b\n'],
		['two endings', '- al‸pha\n- b\n', '\n\nx', '- al\n- \n- xpha\n- b\n'],
		['an ordered item', '1. al‸pha\n2. b\n', '\nx', '1. al\n2. xpha\n3. b\n'],
		['a to-do', '- [x] al‸pha\n', '\nx', '- [x] al\n- [ ] xpha\n'],
		['a nested item in a quote', '> - a\n>   - al‸pha\n', '\nx', '> - a\n>   - al\n>   - xpha\n'],
		['CRLF', '- al‸pha\r\n- b\r\n', '\nx', '- al\r\n- xpha\r\n- b\r\n'],
		['a list at an item’s text end', '- a‸\n', '\n- b', '- a\n- b\n']
	])('law 9 holds Enter’s bytes and then the rest: %s', (_name, text, pasted, bytes) => {
		const { host, real } = calls('');
		const input = at(text, pasted);
		const caret = { from: input.at, to: input.at };
		expect(real(input.source, caret, paste(pasted), 'source')!.source).toBe(bytes);
		expect(pasteAtCaret(real, host, input)).toEqual([]);
		// The ending left as a line of the same item, as it lands outside a list.
		const lined = calls(text.replace('‸', pasted.replace(/\n/g, '\n  ')));
		expect(pasteAtCaret(lined.fake, lined.host, input)).not.toEqual([]);
	});

	it('law 9 leaves an item’s text start to the rows, and judges literal text in an item', () => {
		const { host, real, fake } = calls('zzz\n');
		expect(pasteAtCaret(fake, host, at('- ‸alpha\n- b\n', '\nx'))).toEqual([]);
		const code = at('- ```\n  co‸de\n  ```\n', '\nx');
		expect(pasteAtCaret(real, host, code)).toEqual([]);
		expect(pasteAtCaret(fake, host, code)).not.toEqual([]);
	});

	it('law 3 is silent on a cut from a line’s end that takes more of the item, and on no other', () => {
		const { host, real, fake } = calls('zzz\n');
		for (const shape of ['- a⟦\n  - b⟧\n', '- a⟦\n  lazy⟧\n', '- a⟦\n\n  para⟧\n']) {
			const declared = marked(shape);
			expect(cutPasteBack(fake, host, declared)).toEqual([]);
			const cut = real(declared.source, declared.range, 'cut', 'source')!;
			const caret = { from: cut.caret.at, to: cut.caret.at };
			const back = real(cut.source, caret, paste(cut.clipboard!), 'source')!;
			expect(back.source).not.toBe(declared.source);
		}
		// The next item is no part of the item the range starts in: its cut pastes back exactly.
		for (const beside of ['- a⟦\n- b⟧\n- c\n', '1. a⟦\n2. b⟧\n3. c\n']) {
			expect(cutPasteBack(real, host, marked(beside))).toEqual([]);
			expect(cutPasteBack(fake, host, marked(beside))).not.toEqual([]);
		}
	});
});

// Miss-analysis: these parts of law 9's expected bytes mirror fixes no drawn input reaches, so no
// test asked them; the line under a taken-in container still expected the bytes before its fix.
describe('law 9 where no drawn input reaches', () => {
	const at = (text: string, pasted: string) => ({
		source: text.replace('‸', ''),
		mode: 'source' as const,
		at: text.indexOf('‸'),
		held: { holds: 'text' as const },
		text: pasted
	});

	it.each([
		['a short item line', '+ a\n b‸\n', 'x\n\nc', '+ a\n bx\n\n  c\n', '+ a\n bx\n\n c\n'],
		['a list a quote takes in', '> ‸\n', '> - l', '> - l\n', '> l\n'],
		[
			'text under a list a quote takes in',
			'> a\n>\n>‸\n> b\n',
			'> - l',
			'> a\n>\n> - l\n>\n> b\n',
			'> a\n>\n> - l\n> b\n'
		],
		[
			'text under a quote a quote takes in',
			'> a\n>\n> ‸\n> b\n',
			'> > q',
			'> a\n>\n> > q\n>\n> b\n',
			'> a\n>\n> > q\n> b\n'
		]
	])('holds %s to its bytes', (_name, text, pasted, bytes, wrong) => {
		const { host, real } = calls('');
		const input = at(text, pasted);
		const caret = { from: input.at, to: input.at };
		expect(real(input.source, caret, paste(pasted), 'source')!.source).toBe(bytes);
		expect(pasteAtCaret(real, host, input)).toEqual([]);
		const other = calls(wrong);
		expect(pasteAtCaret(other.fake, other.host, input)).not.toEqual([]);
	});

	it('expects no bytes of a list on an item’s empty row, which takes none in there', () => {
		const { host, real } = calls('');
		const input = at('- a\n\n  ‸\n\n  b\n', '- l');
		const caret = { from: input.at, to: input.at };
		expect(real(input.source, caret, paste('- l'), 'source')!.source).toMatch(/^- a\n\n {2}- l\n/);
		expect(pasteAtCaret(real, host, input)).toEqual([]);
	});
});
