// @vitest-environment jsdom
// Each shape a law steps aside for, held to that shape: the law is silent on it, the core really
// answers otherwise there, and a wrong answer one step outside it still reds.
// Miss-analysis: two reviews found a law's exceptions wider than their rulings, and no test stood
// one step outside an exception.

import { describe, expect, it } from 'vitest';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import { cutPasteBack, pasteAtCaret, replaceLaws, type Call } from './laws';
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
