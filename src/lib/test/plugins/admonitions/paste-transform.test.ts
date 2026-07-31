import { describe, it, expect } from 'vitest';
import { githubAlertsPasteTransform } from '$lib/plugins/admonitions/convert-document';

// Only the paste-transform WRAPPER contract lives here. Conversion correctness is
// covered by convert-document.test.ts and is not re-tested through the wrapper.

const run = (text: string) => githubAlertsPasteTransform.transform(text);

describe('admonitions github-alerts paste transform', () => {
	it('carries the plugin-scoped name used for attribution and register-once', () => {
		expect(githubAlertsPasteTransform.name).toBe('admonitions.github-alerts');
	});

	it('converts a top-level GitHub alert to :::name source', () => {
		expect(run('> [!WARNING]\n> Critical.\n')).toBe(':::warning\nCritical.\n:::\n');
	});

	it('declines (null) alert-free text without touching it', () => {
		expect(run('Just a paragraph.\n')).toBeNull();
	});

	it('declines (null) when the only alert is inside a code fence', () => {
		// The cheap probe sees the marker line, but the fence-safe converter reports
		// nothing changed, so the wrapper declines rather than returning the input.
		expect(run('```md\n> [!NOTE]\n> body\n```\n')).toBeNull();
	});

	it('is idempotent — its own converted output declines a second pass', () => {
		const converted = run('> [!TIP]\n> Handy.\n');
		expect(converted).not.toBeNull();
		expect(run(converted as string)).toBeNull();
	});
});
