import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { getPluginMetadata } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { registerChromePluginsForTests } from './chrome-plugins';
import type { SelectionPoint } from '../../selection/primitives';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { copiedText } from '#lib/test/harness/copied-text.js';

// A cross-block copy whose end lands inside a container's title line (a details summary, a
// callout title) must keep the container's opener: bytes without it reparse to a bare paragraph
// and lose the kind on paste.

// Source mode, where a copied range carries its bytes as they stand.
const SOURCE_READING = fixtureReading({}, 'source');

function point(path: number[], offset: number): SelectionPoint {
	return { path, offset };
}

describe('cross-block copy ending in reserved chrome', () => {
	beforeEach(registerChromePluginsForTests);

	it('mid-title endpoint gives a reparseable note with truncated title, empty body', () => {
		const doc = parse('Above\n\n:::callout Title\nBody\n:::\n\nBelow\n');
		const text = copiedText(doc, point([0], 2), point([1, 0], 14), SOURCE_READING);
		const note = parse(text).children.find((c) => c.kind === 'callout');
		expect(note).toBeDefined();
		expect(note!.children?.map((c) => c.kind)).toEqual(['directiveOpenerLine']);
		expect(trimTrailingLineEnding(note!.children![0].raw)).toBe(':::callout Tit');
	});

	it('whole-title endpoint (offset at chrome end) gives the full title, empty body', () => {
		const doc = parse('Above\n\n:::callout Title\nBody\n:::\n\nBelow\n');
		const text = copiedText(doc, point([0], 2), point([1, 0], 16), SOURCE_READING);
		const note = parse(text).children.find((c) => c.kind === 'callout');
		expect(note!.children?.map((c) => c.kind)).toEqual(['directiveOpenerLine']);
		expect(trimTrailingLineEnding(note!.children![0].raw)).toBe(':::callout Title');
	});

	// The copied opener keeps the live `open` flag; a closed details is copied whole, since the
	// range reaches past its title into the hidden body.
	for (const { label, src, open, kinds, title } of [
		{
			label: 'open',
			src: 'Above\n\n<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n',
			open: true,
			kinds: ['details-summary'],
			title: 'Sum'
		},
		{
			label: 'closed',
			src: 'Above\n\n<details>\n<summary>Summary</summary>\n\nBody\n\n</details>\n',
			open: false,
			kinds: ['details-summary', 'paragraph'],
			title: 'Summary'
		}
	]) {
		it(`mid-summary endpoint (${label}) copies a details with the open flag preserved`, () => {
			const doc = parse(src);
			const text = copiedText(doc, point([0], 2), point([1, 0], 3), SOURCE_READING);
			const details = parse(text).children.find((c) => c.kind === 'details');
			expect(details).toBeDefined();
			expect(getPluginMetadata<{ open: boolean }>(details!)?.open).toBe(open);
			expect(details!.children?.map((c) => c.kind)).toEqual(kinds);
			expect(trimTrailingLineEnding(details!.children![0].raw)).toBe(title);
		});
	}
});
