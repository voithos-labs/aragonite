import { describe, it, expect } from 'vitest';
import { convertGithubAlerts, hasGithubAlert } from '$lib/plugins/admonitions/gh-alert';

describe('convertGithubAlerts', () => {
	it('converts a single-line-body alert', () => {
		const src = '> [!NOTE]\n> Body text.';
		expect(convertGithubAlerts(src).converted).toBe(':::note\nBody text.\n:::');
	});

	it('converts every alert type, lowercasing the name', () => {
		for (const [type, name] of [
			['NOTE', 'note'],
			['TIP', 'tip'],
			['IMPORTANT', 'important'],
			['WARNING', 'warning'],
			['CAUTION', 'caution']
		]) {
			const { converted, changed } = convertGithubAlerts(`> [!${type}]\n> x`);
			expect(changed).toBe(true);
			expect(converted).toBe(`:::${name}\nx\n:::`);
		}
	});

	it('keeps multi-line and multi-paragraph bodies', () => {
		const src = '> [!TIP]\n> One.\n>\n> Two.';
		expect(convertGithubAlerts(src).converted).toBe(':::tip\nOne.\n\nTwo.\n:::');
	});

	it('accepts lowercase and mixed-case markers', () => {
		expect(convertGithubAlerts('> [!warning]\n> x').converted).toBe(':::warning\nx\n:::');
		expect(convertGithubAlerts('> [!Caution]\n> x').converted).toBe(':::caution\nx\n:::');
	});

	it('leaves plain blockquotes and unknown alert types untouched', () => {
		const plain = '> Just a quote.\n> More.';
		expect(convertGithubAlerts(plain)).toEqual({ converted: plain, changed: false });
		const unknown = '> [!DANGER]\n> x';
		expect(convertGithubAlerts(unknown)).toEqual({ converted: unknown, changed: false });
	});

	it('does not treat a marker with trailing text as an alert (GitHub requires it alone)', () => {
		const src = '> [!NOTE] and more';
		expect(convertGithubAlerts(src).changed).toBe(false);
	});

	it('ignores a marker that is not the first line of its blockquote (GitHub semantics)', () => {
		const src = '> plain quote\n> [!NOTE]\n> still a quote';
		expect(convertGithubAlerts(src)).toEqual({ converted: src, changed: false });
	});

	it('converts an alert embedded among other blocks, preserving the rest', () => {
		const src = '# Title\n\n> [!NOTE]\n> Hi.\n\nAfter.';
		expect(convertGithubAlerts(src).converted).toBe('# Title\n\n:::note\nHi.\n:::\n\nAfter.');
	});

	it('converts two alerts in one clipboard', () => {
		const src = '> [!NOTE]\n> a\n\n> [!TIP]\n> b';
		expect(convertGithubAlerts(src).converted).toBe(':::note\na\n:::\n\n:::tip\nb\n:::');
	});

	// Miss-analysis (#171): every fixture drew a FLAT alert, so nothing exercised the one input
	// the conversion changes twice — a nested alert, which loses a quote level here and becomes a
	// top-level marker on the next pass. The dev idempotence probe found it on ordinary content.
	it('converts a nested alert in the same pass, so a second pass changes nothing', () => {
		const src = '> [!NOTE]\n> > [!TIP]\n> > inner\n';
		const once = convertGithubAlerts(src);
		expect(once.converted).toBe('::::note\n:::tip\ninner\n:::\n::::\n');
		expect(convertGithubAlerts(once.converted)).toEqual({
			converted: once.converted,
			changed: false
		});
	});

	it('strips exactly one space after the quote marker', () => {
		expect(convertGithubAlerts('> [!NOTE]\n>  indented').converted).toBe(':::note\n indented\n:::');
		expect(convertGithubAlerts('> [!NOTE]\n>nospace').converted).toBe(':::note\nnospace\n:::');
	});
});

describe('hasGithubAlert', () => {
	it('detects a known alert', () => {
		expect(hasGithubAlert('> [!WARNING]\n> x')).toBe(true);
	});
	it('rejects plain text and unknown types', () => {
		expect(hasGithubAlert('> a quote')).toBe(false);
		expect(hasGithubAlert('> [!DANGER]\n> x')).toBe(false);
	});
});
