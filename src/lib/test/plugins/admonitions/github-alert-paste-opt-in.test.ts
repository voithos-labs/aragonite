// A pasted GitHub alert keeps its bytes by default; `convertAlertsOnPaste` rewrites each top-level
// alert a paste brings to `:::name` source, as 0.11.5's paste transform did, and nothing else.
// Miss-analysis: the transform's rows called it alone, so nothing checked a paste through the
// editor's rewrites (a nested alert, one inside a fence) against what 0.11.5 converted.
import { describe, it, expect } from 'vitest';
import { rewritePaste } from '#lib/testing.js';
import { details } from '#packages/details/src/index.js';
import { admonitions } from '#packages/admonitions/src/index.js';

const converting = () => [admonitions({ convertAlertsOnPaste: true })];
const ALERT = '> [!TIP]\n> Handy.\n';

describe('a pasted alert', () => {
	it('keeps its bytes by default', () => {
		expect(rewritePaste(ALERT, [admonitions])).toBe(ALERT);
	});

	it.each([
		['a top-level alert', ALERT, ':::tip\nHandy.\n:::\n'],
		[
			'two alerts round a paragraph',
			'> [!NOTE]\n> a\n\nmid\n\n> [!Warning]\n> b\n',
			':::note\na\n:::\n\nmid\n\n:::warning\nb\n:::\n'
		],
		[
			'an alert holding an alert, its fence widened past the inner one',
			'> [!NOTE]\n> > [!TIP]\n> > inner\n',
			'::::note\n:::tip\ninner\n:::\n::::\n'
		],
		['a lazy line', '> [!NOTE]\nlazy\n', ':::note\nlazy\n:::\n']
	])('converts %s', (_name, text, converted) => {
		expect(rewritePaste(text, converting())).toBe(converted);
	});

	it.each([
		['alert-free text', 'Just a paragraph.\n'],
		['an alert inside a code fence', '```md\n> [!NOTE]\n> body\n```\n'],
		['an alert nested in a quote', '> > [!NOTE]\n> > x\n'],
		['an alert nested in a list item', '- > [!NOTE]\n  > x\n'],
		['a marker below a quote’s first line', '> plain\n> [!NOTE]\n'],
		['its own converted output', ':::tip\nHandy.\n:::\n']
	])('leaves %s as it is', (_name, text) => {
		expect(rewritePaste(text, converting())).toBe(text);
	});
});

// What 0.11.5's transform wrote for each, its CRLF read as LF.
it.each([
	[ALERT, ':::tip\nHandy.\n:::\n'],
	[
		'> [!NOTE]\n> a\n\nmid\n\n> [!Warning]\n> b\n',
		':::note\na\n:::\n\nmid\n\n:::warning\nb\n:::\n'
	],
	['> [!NOTE]\n> > [!TIP]\n> > inner\n', '::::note\n:::tip\ninner\n:::\n::::\n'],
	['> > [!NOTE]\n> > x\n', '> > [!NOTE]\n> > x\n'],
	['- > [!NOTE]\n  > x\n', '- > [!NOTE]\n  > x\n'],
	['```md\n> [!NOTE]\n> body\n```\n', '```md\n> [!NOTE]\n> body\n```\n'],
	['> [!NOTE]\r\n> crlf\r\n', ':::note\ncrlf\n:::\n'],
	['para\n> [!CAUTION]\n> x\n', 'para\n:::caution\nx\n:::\n'],
	['> [!NOTE]\n>\n> after a blank\n', ':::note\n\nafter a blank\n:::\n']
])('rewrites %j as 0.11.5’s transform did', (text, written) => {
	expect(rewritePaste(text, converting())).toBe(written);
});

// The editor reads the paste with every plugin it lists, so an alert in a section's body is nested,
// as 0.11.5's page-wide reading had it.
it('leaves an alert inside a pasted section as it is', () => {
	const text = '<details>\n<summary>S</summary>\n\n> [!NOTE]\n> x\n\n</details>\n';
	expect(rewritePaste(text, [details, admonitions({ convertAlertsOnPaste: true })])).toBe(text);
});
