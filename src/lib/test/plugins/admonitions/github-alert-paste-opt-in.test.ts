// A pasted GitHub alert keeps its bytes by default; `convertAlertsOnPaste` rewrites each top-level
// alert a paste brings to `:::name` source, as 0.11.5's paste transform did, and nothing else.
// Miss-analysis: the transform's rows called it alone, so nothing checked a paste through the
// editor's rewrites (a nested alert, one inside a fence) against what 0.11.5 converted.
import { describe, it, expect } from 'vitest';
import { rewritePaste } from '#lib/testing.js';
import {
	admonitions,
	convertGithubAlertsInDocument,
	hasGithubAlert
} from '#packages/admonitions/src/index.js';

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

// 0.11.5's transform, from the converters it ran: the whole paste through the document converter.
const transformed = (text: string) =>
	hasGithubAlert(text) ? convertGithubAlertsInDocument(text).converted : text;

it.each([
	ALERT,
	'> [!NOTE]\n> a\n\nmid\n\n> [!Warning]\n> b\n',
	'> [!NOTE]\n> > [!TIP]\n> > inner\n',
	'> > [!NOTE]\n> > x\n',
	'- > [!NOTE]\n  > x\n',
	'```md\n> [!NOTE]\n> body\n```\n',
	'> [!NOTE]\r\n> crlf\r\n',
	'para\n> [!CAUTION]\n> x\n',
	'> [!NOTE]\n>\n> after a blank\n'
])('rewrites %j as 0.11.5’s transform did', (text) => {
	expect(rewritePaste(text, converting())).toBe(transformed(text).replace(/\r\n/g, '\n'));
});
