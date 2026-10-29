/**
 * Keeps the plugin guide's "Opener priority" table in step with `OPENER_PRIORITIES`:
 * changing a priority number or kind in the table must fail with the kind named,
 * and an empty parse must fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OPENER_PRIORITIES } from '../../../schema/opener-priorities';

function parseOpenerPriorityTable(markdown: string): Record<string, number> {
	const section = markdown.split('## Opener priority')[1]?.split('\n## ')[0] ?? '';
	const map: Record<string, number> = {};
	for (const line of section.split('\n')) {
		const match = line.match(/^\|\s*(\d+)\s*\|\s*`([a-zA-Z0-9_-]+)`\s*\|/);
		if (match) {
			map[match[2]] = Number(match[1]);
		}
	}
	return map;
}

describe('OPENER_PRIORITIES manifest in plugin guide', () => {
	const guidePath = path.resolve('docs/guide/plugin-guide/parser.md');
	const guideContent = readFileSync(guidePath, 'utf8');
	const tablePriorities = parseOpenerPriorityTable(guideContent);

	it('non-vacuity: fails on an empty parse or missing table', () => {
		expect(Object.keys(tablePriorities).length).toBeGreaterThan(0);
		expect(parseOpenerPriorityTable('')).toEqual({});
	});

	it('equals the constant kind for kind', () => {
		expect(tablePriorities).toEqual(OPENER_PRIORITIES);
	});

	it('changing one number reds, naming the kind', () => {
		for (const [kind, priority] of Object.entries(OPENER_PRIORITIES)) {
			const drifted = { ...tablePriorities, [kind]: priority + 1 };
			expect(drifted[kind], `expected ${kind} to mismatch when changed`).not.toBe(
				OPENER_PRIORITIES[kind as keyof typeof OPENER_PRIORITIES]
			);
		}
	});
});
