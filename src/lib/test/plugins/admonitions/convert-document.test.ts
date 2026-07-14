import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { convertGithubAlertsInDocument } from '$lib/plugins/admonitions/convert-document';

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('convertGithubAlertsInDocument', () => {
	it('converts a top-level alert and leaves surrounding blocks byte-identical', () => {
		const src = '# Title\n\n> [!WARNING]\n> Critical.\n> More.\n\nAfter.\n';
		const { converted, changed } = convertGithubAlertsInDocument(src);
		expect(changed).toBe(true);
		expect(converted).toBe('# Title\n\n:::warning\nCritical.\nMore.\n:::\n\nAfter.\n');
	});

	it('does NOT convert alert-shaped lines inside a fenced code block', () => {
		const src = '```markdown\n> [!NOTE]\n> sample\n```\n';
		expect(convertGithubAlertsInDocument(src)).toEqual({ converted: src, changed: false });
	});

	it('does NOT convert a marker that is not the first line of its blockquote', () => {
		const src = '> plain quote\n> [!NOTE]\n> still a quote\n';
		expect(convertGithubAlertsInDocument(src)).toEqual({ converted: src, changed: false });
	});

	it('keeps a mid-body literal [!TYPE] marker as body text (GitHub semantics)', () => {
		const src = '> [!NOTE]\n> body\n> [!TIP]\n> more\n';
		const { converted } = convertGithubAlertsInDocument(src);
		expect(converted).toBe(':::note\nbody\n[!TIP]\nmore\n:::\n');
	});

	it('carries lazy-continuation lines into the admonition body', () => {
		const src = '> [!TIP]\n> quoted line\nlazy line\n';
		const { converted } = convertGithubAlertsInDocument(src);
		expect(converted).toBe(':::tip\nquoted line\nlazy line\n:::\n');
	});

	it('converts multiple alerts and leaves plain blockquotes alone', () => {
		const src = '> [!NOTE]\n> a\n\n> plain\n\n> [!CAUTION]\n> b\n';
		const { converted } = convertGithubAlertsInDocument(src);
		expect(converted).toBe(':::note\na\n:::\n\n> plain\n\n:::caution\nb\n:::\n');
	});

	it('returns the input byte-for-byte when nothing converts (reconstruction identity)', () => {
		const src = '# H\n\n- list\n  - nested\n\n> quote\n\n\ttab-indented code\n\ntrailing text';
		const res = convertGithubAlertsInDocument(src);
		expect(res.changed).toBe(false);
		expect(res.converted).toBe(src);
		expect(res.converted).toBe(serialize(parse(src)));
	});

	it('handles a document-final alert without a trailing newline', () => {
		const src = 'Intro.\n\n> [!IMPORTANT]\n> Last block, no newline';
		const { converted, changed } = convertGithubAlertsInDocument(src);
		expect(changed).toBe(true);
		expect(converted).toBe('Intro.\n\n:::important\nLast block, no newline\n:::');
	});

	it('output parses to admonitions and round-trips byte-for-byte', () => {
		const src = 'Intro.\n\n> [!WARNING]\n> Careful now.\n\n```text\n> [!NOTE]\n```\n';
		const { converted } = convertGithubAlertsInDocument(src);
		const doc = parse(converted);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'admonition', 'fencedCode']);
		expect(serialize(doc)).toBe(converted);
	});
});
