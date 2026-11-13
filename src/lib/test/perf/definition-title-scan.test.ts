// A definition's title read over a run of lines is scanned in a few passes: the window joins twice
// the lines each time a read runs off its end, never one line a pass.
// Miss-analysis: the definition cost rows timed whole reads; none counted how often the title
// scanner was handed the joined text, which grew a line at a time.
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/core/inline/scan/link-grammar.js', async (original) => {
	const real = await original<typeof import('#lib/core/inline/scan/link-grammar.js')>();
	return { ...real, readTitle: vi.fn(real.readTitle) };
});

/** How often the title scanner reads a title started under a definition, over `lines` more. */
async function scans(lines: number): Promise<number> {
	// The setup loaded the parser before the mock, so it is loaded again over the mocked scanner.
	vi.resetModules();
	const { readTitle } = await import('#lib/core/inline/scan/link-grammar.js');
	const { definitionReadingNotFinal } = await import('#lib/core/parsers/link-reference.js');
	vi.mocked(readTitle).mockClear();
	expect(definitionReadingNotFinal(`[a]: /u\n"t\n${'x\n'.repeat(lines)}`)).toBe(true);
	return vi.mocked(readTitle).mock.calls.length;
}

describe('a title started over a long run', () => {
	it('is scanned about as often at 8,000 lines as at 500', async () => {
		const [short, long] = [await scans(500), await scans(8000)];
		expect(short).toBeGreaterThan(0);
		expect(long).toBeLessThanOrEqual(short + 5);
	});
});
