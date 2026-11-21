// @vitest-environment jsdom
// Miss-analysis: picker tests read rows via `listLanguages()`, never asking one row per language.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { activationHighlighting } from '#lib/test/harness/code-highlighters.js';
import { mountCode, type MountedCode } from './mount-code';
import { dispatchKey } from '#lib/test/harness/settle.js';

const activePlugins = activationHighlighting([
	{ name: 'c', aliases: [] },
	{ name: 'cpp', aliases: ['c++'] },
	{ name: 'javascript', aliases: ['js'] },
	{ name: 'rust', aliases: ['rs'] }
]);
const FENCE = '```js\nconst x = 1\n```\n';

let mounted: MountedCode;

function rowsOver(languages: Parameters<typeof activationHighlighting>[0]): string[] {
	mounted = mountCode(FENCE, {
		mode: () => 'live',
		services: { activePlugins: activationHighlighting(languages) }
	});
	openField();
	return rows();
}

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
	dispatchKey(field, { key });
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
	mounted = mountCode(FENCE, { mode: () => 'live', services: { activePlugins } });
});
afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('CodeBlock: the language picker’s list', () => {
	// The block's own spelling leads, and its canonical form does not follow it down the list.
	it('lists one row per language, not one per spelling', () => {
		openField();

		expect(rows()).toEqual(['js', 'text', 'c', 'cpp', 'rust']);
	});

	// Miss-analysis: every list was handed over sorted, so a picker that sorted its rows itself, and
	// could not put a highlighter's common languages first, passed.
	it('lists the rows in the order the highlighter lists its languages', async () => {
		await mounted.dispose();
		const order = rowsOver([
			{ name: 'rust', aliases: ['rs'] },
			{ name: 'javascript', aliases: ['js'] },
			{ name: 'c' }
		]);

		expect(order).toEqual(['js', 'text', 'rust', 'c']);
	});

	it('finds a language by an alias typed into the filter', () => {
		const field = openField();

		type(field, 'rs');

		expect(rows()).toEqual(['rust']);
	});

	// The row and the fence name one language in two spellings, so the mark that says "this is
	// what you have" compares through the registry rather than by text.
	it('marks the row the fence already uses, whichever spelling each is in', () => {
		const field = openField();

		type(field, 'javascript');

		const option = mounted.target.querySelector('.code-lang-list [role="option"]');
		expect(option?.getAttribute('aria-selected')).toBe('true');
	});
});

describe('CodeBlock: the language picker’s commit', () => {
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

	// A hovered row highlights like one reached by arrow, so it has to outrank the typed
	// spelling the same way.
	it('takes the row the pointer rests on, the same as an arrowed one', () => {
		const field = openField();

		type(field, 'c');
		hover(1);
		press(field, 'Enter');

		expect(commits()).toEqual(['```cpp\nconst x = 1\n```\n']);
	});
});
