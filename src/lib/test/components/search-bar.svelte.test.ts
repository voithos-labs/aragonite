// @vitest-environment jsdom
// The search bar's own wiring: what each control and key asks of the search state, and how the
// readout reads. The scan, the matches and the highlights are `search-state.test.ts` and e2e.
// Miss-analysis: the bar was driven through a browser only, so each toggle, key and readout state
// rode a full page load.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SearchBar from '$lib/components/SearchBar.svelte';
import { EDITOR_SERVICES_KEY } from '$lib/editor-keys';
import {
	SEARCH_CLOSE_LABEL,
	SEARCH_FIND,
	SEARCH_MATCH_CASE,
	SEARCH_NEXT_LABEL,
	SEARCH_PREVIOUS_LABEL,
	SEARCH_REGEX,
	SEARCH_REPLACE,
	SEARCH_TOGGLE_REPLACE,
	SEARCH_WHOLE_WORD
} from '$lib/a11y-strings';

function fakeSearch(over: Record<string, unknown> = {}) {
	return {
		isOpen: true,
		query: '',
		replacement: '',
		options: { caseSensitive: false, wholeWord: false, regex: false },
		error: null as string | null,
		isScanning: false,
		matches: [] as unknown[],
		activeIndex: 0,
		replacedCount: null as number | null,
		setQuery: vi.fn(),
		setReplacement: vi.fn(),
		setOptions: vi.fn(),
		next: vi.fn(),
		prev: vi.fn(),
		close: vi.fn(),
		replaceCurrent: vi.fn(),
		replaceAll: vi.fn(),
		...over
	};
}

const mounted: Array<() => void> = [];

function render(
	search: ReturnType<typeof fakeSearch>,
	props: { replaceExpanded?: boolean; onToggleReplace?: () => void } = {}
): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SearchBar, {
		target,
		props,
		context: new Map([[EDITOR_SERVICES_KEY, { search }]])
	});
	flushSync();
	mounted.push(() => {
		void unmount(instance);
		target.remove();
	});
	return target;
}

afterEach(() => mounted.splice(0).forEach((undo) => undo()));

const button = (root: HTMLElement, label: string) =>
	root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const input = (root: HTMLElement, label: string) =>
	root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const readout = (root: HTMLElement) => root.querySelector('.search-count')!;

function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(e);
	return e;
}

describe('the option toggles', () => {
	const TOGGLES = [
		[SEARCH_MATCH_CASE, 'caseSensitive'],
		[SEARCH_WHOLE_WORD, 'wholeWord'],
		[SEARCH_REGEX, 'regex']
	] as const;

	it.each(TOGGLES)('%s flips its own option on and off', (label, key) => {
		const off = fakeSearch();
		const offBar = render(off);
		expect(button(offBar, label).getAttribute('aria-pressed')).toBe('false');
		button(offBar, label).click();
		expect(off.setOptions).toHaveBeenCalledWith({ [key]: true });

		const on = fakeSearch({ options: { caseSensitive: false, wholeWord: false, [key]: true } });
		const onBar = render(on);
		expect(button(onBar, label).getAttribute('aria-pressed')).toBe('true');
		button(onBar, label).click();
		expect(on.setOptions).toHaveBeenCalledWith({ [key]: false });
	});
});

describe('the find field', () => {
	it('Enter steps to the next match and Shift+Enter to the previous', () => {
		const search = fakeSearch();
		const field = input(render(search), SEARCH_FIND);

		expect(press(field, 'Enter').defaultPrevented).toBe(true);
		press(field, 'Enter', { shiftKey: true });

		expect(search.next).toHaveBeenCalledTimes(1);
		expect(search.prev).toHaveBeenCalledTimes(1);
	});

	it('Escape closes the bar', () => {
		const search = fakeSearch();

		press(input(render(search), SEARCH_FIND), 'Escape');

		expect(search.close).toHaveBeenCalledTimes(1);
	});

	it('typing hands the query to the search', () => {
		const search = fakeSearch();
		const field = input(render(search), SEARCH_FIND);

		field.value = 'alpha';
		field.dispatchEvent(new Event('input', { bubbles: true }));

		expect(search.setQuery).toHaveBeenCalledWith('alpha');
	});
});

describe('the buttons', () => {
	it('step, close and the chevron each ask for their own action', () => {
		const search = fakeSearch();
		const onToggleReplace = vi.fn();
		const bar = render(search, { onToggleReplace });

		button(bar, SEARCH_NEXT_LABEL).click();
		button(bar, SEARCH_PREVIOUS_LABEL).click();
		button(bar, SEARCH_CLOSE_LABEL).click();
		button(bar, SEARCH_TOGGLE_REPLACE).click();

		expect(search.next).toHaveBeenCalledTimes(1);
		expect(search.prev).toHaveBeenCalledTimes(1);
		expect(search.close).toHaveBeenCalledTimes(1);
		expect(onToggleReplace).toHaveBeenCalledTimes(1);
	});

	it('draws nothing while the search is closed', () => {
		expect(render(fakeSearch({ isOpen: false })).querySelector('.search-bar')).toBeNull();
	});
});

describe('the replace row', () => {
	it('shows only while expanded, and the chevron reports it', () => {
		const collapsed = render(fakeSearch(), { replaceExpanded: false });
		expect(input(collapsed, SEARCH_REPLACE)).toBeNull();
		expect(button(collapsed, SEARCH_TOGGLE_REPLACE).getAttribute('aria-expanded')).toBe('false');

		const expanded = render(fakeSearch(), { replaceExpanded: true });
		expect(input(expanded, SEARCH_REPLACE)).not.toBeNull();
		expect(button(expanded, SEARCH_TOGGLE_REPLACE).getAttribute('aria-expanded')).toBe('true');
	});

	it('Enter replaces the current match, Escape closes, and the buttons replace one or all', () => {
		const search = fakeSearch();
		const bar = render(search, { replaceExpanded: true });
		const field = input(bar, SEARCH_REPLACE);

		press(field, 'Enter');
		press(field, 'Escape');
		const [replace, all] = [...bar.querySelectorAll<HTMLButtonElement>('.search-btn')];
		replace.click();
		all.click();

		expect(search.replaceCurrent).toHaveBeenCalledTimes(2);
		expect(search.close).toHaveBeenCalledTimes(1);
		expect(search.replaceAll).toHaveBeenCalledTimes(1);
	});

	it('typing hands the replacement to the search', () => {
		const search = fakeSearch();
		const field = input(render(search, { replaceExpanded: true }), SEARCH_REPLACE);

		field.value = 'omega';
		field.dispatchEvent(new Event('input', { bubbles: true }));

		expect(search.setReplacement).toHaveBeenCalledWith('omega');
	});
});

describe('the readout', () => {
	const STATES: [name: string, over: Record<string, unknown>, text: string, error: boolean][] = [
		['the position among the matches', { matches: [1, 2, 3], activeIndex: 1 }, '2 / 3', false],
		['no results', {}, 'No results', false],
		['a scan in progress', { isScanning: true }, 'Searching…', false],
		['a replaced count', { replacedCount: 4 }, '4 replaced', false],
		['an error in place of any count', { error: 'Unterminated group', matches: [1] }, '', true]
	];

	it.each(STATES)('reads %s', (_name, over, text, error) => {
		const cell = readout(render(fakeSearch(over)));

		if (error) expect(cell.textContent).toContain('Unterminated group');
		else expect(cell.textContent?.trim()).toBe(text);
		expect(cell.classList.contains('error')).toBe(error);
	});
});
