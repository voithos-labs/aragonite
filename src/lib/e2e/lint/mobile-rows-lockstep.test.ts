/**
 * Every device row in `scripts/mobile/` has a scenario in `requirements/mobile/`, and every
 * scenario a row, so the two lists pair the way a spec and its requirement file do. A scenario's
 * name is its bullet's text before the first colon, and it equals the row's key.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLATFORMS = ['android', 'ios'] as const;

/** The names of a requirement file's top-level bullets: the text before each one's first colon. */
export function scenarioNames(text: string): string[] {
	const names: string[] = [];
	let inFence = false;
	for (const line of text.split('\n')) {
		if (/^\s*```/.test(line)) inFence = !inFence;
		const bullet = !inFence && line.match(/^-\s+([^:]+):/);
		if (bullet) names.push(bullet[1].trim());
	}
	return names;
}

async function rowNames(platform: string): Promise<string[]> {
	const file = pathToFileURL(path.resolve(`scripts/mobile/${platform}-rows.mjs`)).href;
	const module: { rows: Record<string, unknown> } = await import(/* @vite-ignore */ file);
	return Object.keys(module.rows);
}

describe('device rows and their scenarios pair', () => {
	for (const platform of PLATFORMS) {
		it(`${platform}: every row has a scenario and every scenario a row`, async () => {
			const scenarios = scenarioNames(
				readFileSync(`src/lib/e2e/requirements/mobile/${platform}.md`, 'utf8')
			);
			const rows = await rowNames(platform);
			expect(rows.length, `${platform} has no rows`).toBeGreaterThan(0);
			expect(
				rows.filter((row) => !scenarios.includes(row)),
				`rows with no scenario in requirements/mobile/${platform}.md`
			).toEqual([]);
			expect(
				scenarios.filter((name) => !rows.includes(name)),
				`scenarios with no row in scripts/mobile/${platform}-rows.mjs`
			).toEqual([]);
		});
	}

	it('names a scenario by its bullet up to the first colon, skipping detail and code', () => {
		const text = [
			'# Feature: x',
			'## Rows',
			'- a swipe keeps the caret: the caret stays, at 1:2.',
			'  - Miss-analysis: nested detail, not a scenario',
			'```',
			'- inside a fence: not a scenario',
			'```',
			'- a tap clears a range: it does'
		].join('\n');
		expect(scenarioNames(text)).toEqual(['a swipe keeps the caret', 'a tap clears a range']);
	});
});
