import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../../core/parser';
import { registerBlockOpener, type OpenContext } from '../../../schema/block-openers';
import { declarePluginKind } from '../../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../../schema/registry-reset';
import type { ParsedLine } from '../../../core/lines';

// A strip that rewrites a line's `raw` while spreading its old offsets desyncs the whole
// stream from its own bytes. The offsets are unobservable through the CST, since parsers
// key on `raw`/`text`, so they are pinned through `OpenContext.lines` instead.

function offsetPairs(lines: ParsedLine[]): [number, number][] {
	return lines.map((l) => [l.start, l.end]);
}

describe('task-checkbox strip recomputes stripped-line offsets', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('hands a task item body a stream whose offsets match its bytes', () => {
		let taskBody: ParsedLine[] | null = null;
		const kind = declarePluginKind('offset-probe');
		registerBlockOpener(kind, {
			priority: 1, // below every built-in: offered first, stashes, then declines
			interruptsParagraph: false,
			tryOpen: (ctx: OpenContext) => {
				if (ctx.line.text === 'more') taskBody = ctx.lines;
				return null;
			}
		});

		// `more` is the first line an opener is offered: the task line itself is paragraph text.
		parse('- [ ] todo\n\n  more\n');

		expect(taskBody).not.toBeNull();
		const lines = taskBody!;

		// `todo\n` (5 bytes), the blank line, then `more\n` (5 bytes): a contiguous stream from 0.
		expect(offsetPairs(lines)).toEqual([
			[0, 5],
			[5, 6],
			[6, 11]
		]);

		// The ParsedLine contract: each span equals its own bytes, and the stream is
		// gap-free from 0.
		let cursor = 0;
		for (const line of lines) {
			expect(line.start).toBe(cursor);
			expect(line.end).toBe(cursor + line.raw.length);
			cursor = line.end;
		}
	});
});
