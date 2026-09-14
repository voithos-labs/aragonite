// @vitest-environment jsdom
//
// Miss-analysis: every picker test read the list through `listLanguages()`, which listed aliases
// as names, so no test ever asked what a ROW is — one per language, or one per spelling.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { LanguageFn } from 'highlight.js';
import {
	registerLanguage,
	__resetRegistryForTests
} from '$lib/components/blocks/code/code-languages';
import { mountCode, type MountedCode } from './mount-code';

const stubGrammar = (() => ({ name: 'stub' })) as unknown as LanguageFn;
const FENCE = '```js\nconst x = 1\n```\n';

let mounted: MountedCode;

function openField(): HTMLInputElement {
	const button = mounted.target.querySelector('.code-lang-button') as HTMLButtonElement;
	button.click();
	flushSync();
	return mounted.target.querySelector('.code-lang-picker input') as HTMLInputElement;
}

function type(field: HTMLInputElement, value: string): void {
	field.value = value;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function press(field: HTMLInputElement, key: string): void {
	field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	flushSync();
}

function hover(row: number): void {
	const options = mounted.target.querySelectorAll<HTMLElement>('.code-lang-list [role="option"]');
	options[row].dispatchEvent(new MouseEvent('mouseenter'));
	flushSync();
}

function rows(): string[] {
	return [...mounted.target.querySelectorAll('.code-lang-name')].map((el) => el.textContent ?? '');
}

function commits(): string[] {
	return vi
		.mocked(mounted.blockEdit.updateBlockContent)
		.mock.calls.map((call) => call[1] as string);
}

beforeEach(() => {
	__resetRegistryForTests();
	registerLanguage('javascript', stubGrammar, ['js']);
	registerLanguage('rust', stubGrammar, ['rs']);
	registerLanguage('c', stubGrammar);
	registerLanguage('cpp', stubGrammar, ['c++']);
	mounted = mountCode(FENCE, { policies: { presentationMode: () => 'live' } });
});
afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('CodeBlock — the language picker’s list', () => {
	// The block's own spelling leads, and its canonical twin does not follow it down the list.
	it('lists one row per language, not one per spelling', () => {
		openField();

		expect(rows()).toEqual(['js', 'text', 'c', 'cpp', 'rust']);
	});

	it('finds a language by an alias typed into the filter', () => {
		const field = openField();

		type(field, 'rs');

		expect(rows()).toEqual(['rust']);
	});
});

describe('CodeBlock — the language picker’s commit', () => {
	it('keeps a typed alias as typed: a spelling the registry knows is a name, not a query', () => {
		const field = openField();

		type(field, 'rs');
		press(field, 'Enter');

		expect(commits()).toEqual(['```rs\nconst x = 1\n```\n']);
	});

	it('takes the highlighted row when the user arrows off the spelling they typed', () => {
		const field = openField();

		type(field, 'c');
		press(field, 'ArrowDown');
		press(field, 'Enter');

		expect(commits()).toEqual(['```cpp\nconst x = 1\n```\n']);
	});

	// The pointer is the rule's other arm: a hovered row highlights like an arrowed one, so it
	// has to outrank the typed spelling the same way.
	it('takes the row the pointer rests on, the same as an arrowed one', () => {
		const field = openField();

		type(field, 'c');
		hover(1);
		press(field, 'Enter');

		expect(commits()).toEqual(['```cpp\nconst x = 1\n```\n']);
	});
});
