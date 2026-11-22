// @vitest-environment jsdom
// Miss-analysis: the picker's rows were tested over stub lists only, so the 194 rows the highlight
// package handed it by default, against 0.11.5's 25, reached no row.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { highlightJs, type HighlightJsOptions } from '#packages/highlight/src/renderer.js';
import { allLanguages } from '#packages/highlight/src/renderer/all-languages.js';
import { activationWith } from '#lib/test/harness/code-highlighters.js';
import { mountCode, type MountedCode } from './mount-code';

// What 0.11.5's picker showed for a fence with no language, row for row.
const ROWS_0_11_5 = [
	...['text', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'go', 'html', 'java'],
	...['javascript', 'json', 'kotlin', 'latex', 'markdown', 'php', 'powershell', 'python', 'ruby'],
	...['rust', 'sql', 'swift', 'typescript', 'yaml']
];

let mounted: MountedCode | undefined;
afterEach(async () => {
	await mounted?.dispose();
	document.body.innerHTML = '';
});

function pickerRows(options: HighlightJsOptions): string[] {
	const { activation } = activationWith({ name: 'highlight', code: highlightJs(options)() });
	mounted = mountCode('```\nx\n```\n', {
		mode: () => 'live',
		services: { activePlugins: activation }
	});
	(mounted.target.querySelector('.code-lang-button') as HTMLButtonElement).click();
	flushSync();
	return [...mounted.target.querySelectorAll('.code-lang-name')].map((el) => el.textContent ?? '');
}

describe('the language picker with the highlight package', () => {
	it("lists 0.11.5's rows by default, by its names and in its order", () => {
		expect(pickerRows({})).toEqual(ROWS_0_11_5);
	});

	it('lists those rows first with every grammar opted in, then the rest alphabetically', () => {
		const rows = pickerRows({ languages: allLanguages });
		expect(rows.slice(0, ROWS_0_11_5.length)).toEqual(ROWS_0_11_5);
		// highlight.js's plaintext answers `text`, so the picker's own `text` row stands for it.
		const others = Object.keys(allLanguages).filter((name) => name !== 'plaintext');
		expect(rows.slice(ROWS_0_11_5.length)).toEqual(others.sort());
	});
});
