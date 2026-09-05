/**
 * The README's embed snippet is the one piece of code every newcomer pastes, so it is also a
 * route the external-consumer gate mounts and reads for legibility. The two copies stay
 * byte-identical here, and the consumer guide's copy may only add its save button.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const README = path.resolve('README.md');
const GUIDE = path.resolve('docs/guide/consumer-guide.md');
const ROUTE = path.resolve('examples/consumer/src/routes/quickstart/+page.svelte');

/** The body of the first ```svelte fence in a markdown file. */
function firstSvelteFence(file: string): string {
	const match = /```svelte\n([\s\S]*?)\n```/.exec(readFileSync(file, 'utf8'));
	if (!match) throw new Error(`${path.basename(file)} has no svelte fence`);
	return match[1];
}

describe('the quickstart snippet is the consumer route the smoke gate mounts', () => {
	it('the README snippet and the quickstart route are the same bytes', () => {
		expect(readFileSync(ROUTE, 'utf8').trimEnd()).toBe(firstSvelteFence(README).trimEnd());
	});

	it("the consumer guide's snippet is the README's plus its save button", () => {
		const guide = firstSvelteFence(GUIDE).trimEnd();
		const readme = firstSvelteFence(README).trimEnd();
		expect(guide.startsWith(readme)).toBe(true);
		const extra = guide.slice(readme.length).trim().split('\n');
		expect(extra).toHaveLength(1);
		expect(extra[0]).toMatch(/^<button .*getSource\(\).*<\/button>$/);
	});
});
