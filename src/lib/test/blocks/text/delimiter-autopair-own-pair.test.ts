// @vitest-environment jsdom
//
// GH #469: the auto-pair steps over, collapses or deletes only the empty pair it wrote itself, so
// two delimiters the user typed keep both bytes when a key lands between them.
// Miss-analysis: every empty-pair row started from a pair the auto-pair had just written, and the
// resolver read ownership off the bytes, so no case typed `**b`, moved into the stars and keyed.
import { defaultGrammarView } from '$lib/schema/block-openers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	applyDelimiterAutoPair,
	type AutoPairSurface
} from '$lib/components/blocks/text/delimiter-autopair';
import {
	createAutoPairRecord,
	type AutoPairRecord
} from '$lib/components/blocks/text/auto-pair-record';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';

/** A block's line under the handler, with the browser's own edit where the handler declines. */
class TypedLine {
	private readonly surface: AutoPairSurface;

	constructor(
		public text: string,
		public caret: number,
		record: AutoPairRecord
	) {
		this.surface = {
			text: () => this.text,
			content: () => ({ start: 0, end: this.text.length }),
			caret: () => this.caret,
			hasSelection: () => false,
			isRevealing: () => false,
			foldReveal: () => null,
			markersPaint: () => true,
			setCaret: (offset) => (this.caret = offset),
			seatOutside: () => {},
			write: (next, _before, after) => {
				this.text = next;
				this.caret = after;
			},
			linkRef: { grammar: defaultGrammarView },
			ownPairs: record.forBlock()
		};
	}

	type(keys: string): this {
		for (const data of keys) {
			const e = new InputEvent('beforeinput', { inputType: 'insertText', data, cancelable: true });
			if (applyDelimiterAutoPair(e, this.surface)) continue;
			this.text = this.text.slice(0, this.caret) + data + this.text.slice(this.caret);
			this.caret++;
		}
		return this;
	}

	backspace(): this {
		const e = new InputEvent('beforeinput', {
			inputType: 'deleteContentBackward',
			cancelable: true
		});
		if (applyDelimiterAutoPair(e, this.surface)) return this;
		this.text = this.text.slice(0, this.caret - 1) + this.text.slice(this.caret);
		this.caret--;
		return this;
	}

	moveTo(caret: number): this {
		this.caret = caret;
		return this;
	}
}

const line = (text: string, caret = text.length, record = createAutoPairRecord()) =>
	new TypedLine(text, caret, record);

describe('a pair the user typed is not the auto-pair’s', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMathInline();
	});
	afterEach(resetPluginPlatformForTests);

	it.each([
		['stars', '**b', 'a **b**', 'a * *b**'],
		['underscores', '__b', 'a __b__', 'a _ _b__'],
		['dollars', '$$b', 'a $$b', 'a $ $b']
	])('a space between the %s of a typed run keeps both', (_label, keys, typed, spaced) => {
		const block = line('a ').type(keys);
		expect(block.text).toBe(typed);

		expect(block.moveTo(3).type(' ').text).toBe(spaced);
	});

	it('Backspace between the stars of a typed `**b` takes one', () => {
		expect(line('a ').type('**b').moveTo(3).backspace().text).toBe('a *b**');
	});

	it('a star typed between them is one more star', () => {
		expect(line('a ').type('**b').moveTo(3).type('*').text).toBe('a ***b**');
	});

	it('a pair the auto-pair wrote stops being its own once a key lands elsewhere', () => {
		const block = line('a ').type('*').moveTo(0).type('z');
		expect(block.text).toBe('za **');

		expect(block.moveTo(4).type(' ').text).toBe('za * *');
	});

	it('a key in another block ends the pair', () => {
		const record = createAutoPairRecord();
		const first = line('a ', 2, record).type('*');
		line('other', 5, record).type('x');

		expect(first.type(' ').text).toBe('a * *');
	});
});

describe('the pair the auto-pair wrote stays its own', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMathInline();
	});
	afterEach(resetPluginPlatformForTests);

	it('drops its partner for a first byte that makes no construct', () => {
		expect(line('a ').type('* ').text).toBe('a * ');
		expect(line('cost ').type('$5').text).toBe('cost $5');
	});

	it('takes both runs on Backspace, between them and past a stepped-over partner', () => {
		expect(line('a ').type('*').backspace().text).toBe('a ');
		expect(line('pay ').type('$$').backspace().text).toBe('pay ');
	});

	it('survives typing inside it, so the emptied pair still goes whole', () => {
		const block = line('a ').type('*b').backspace();
		expect(block.text).toBe('a **');

		expect(block.backspace().text).toBe('a ');
	});

	it('grows and steps over as before', () => {
		expect(line('a ').type('**b**').type(' ').text).toBe('a **b** ');
		expect(line('a ').type('`x`').type(' ').text).toBe('a `x` ');
	});
});
