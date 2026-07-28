import { describe, it, expect } from 'vitest';
import { parse, serialize } from '$lib';

// With the admonitions plugin NOT installed, a GitHub-alert blockquote parses as a
// plain blockquote: its bytes are never corrupted, so uninstalling the plugin never
// breaks a saved document. Installed native rendering is github-alert.test.ts.

describe('github alert — uninstalled fallback', () => {
	const cases = [
		'> [!NOTE]\n> Body.\n',
		'> [!WARNING]\r\n> CRLF body.\r\n',
		'# H\n\n> [!TIP]\n> x\n\nAfter.\n'
	];
	for (const src of cases) {
		it(`parses ${JSON.stringify(src)} as a plain blockquote, bytes intact`, () => {
			const alertBlock = parse(src).children.find((c) => c.raw.includes('[!'));
			expect(alertBlock?.kind).toBe('blockquote');
			expect(serialize(parse(src))).toBe(src);
		});
	}
});
