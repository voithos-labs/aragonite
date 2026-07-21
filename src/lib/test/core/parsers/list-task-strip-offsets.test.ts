import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../../core/parser';
import { registerBlockOpener, type OpenContext } from '../../../schema/block-openers';
import { declarePluginKind } from '../../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../../schema/registry-reset';
import { resetEditorEnv } from '../../../env';
import type { ParsedLine } from '../../../core/lines';

// A task-list item's body is reparsed from a marker-stripped ParsedLine stream. The
// stripped lines carry `start`/`end` offsets that the parser hands to any block
// opener as `OpenContext.lines` — the documented public seam a plugin opener reads.
// The task-checkbox strip once rewrote line 0's `raw` (dropping `[ ] `) while
// spreading its OLD offsets, so line 0's span overstated by the marker length and the
// whole stream desynced from its own bytes. The offsets are unobservable through the
// CST (parsers key on `raw`/`text`), so this pins them at the opener seam.

function offsetPairs(lines: ParsedLine[]): [number, number][] {
	return lines.map((l) => [l.start, l.end]);
}

describe('task-checkbox strip recomputes stripped-line offsets', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());
	afterEach(() => resetEditorEnv());

	it('hands a task item body a stream whose offsets match its bytes', () => {
		let taskBody: ParsedLine[] | null = null;
		const kind = declarePluginKind('offset-probe');
		registerBlockOpener(kind, {
			priority: 1, // below every built-in: offered first, stashes, then declines
			interruptsParagraph: false,
			tryOpen: (ctx: OpenContext) => {
				if (ctx.line.text === 'todo') taskBody = ctx.lines;
				return null;
			}
		});

		parse('- [ ] todo\nmore\n');

		expect(taskBody).not.toBeNull();
		const lines = taskBody!;

		// `todo\n` (5 bytes) then `more\n` (5 bytes): a contiguous stream from 0.
		expect(offsetPairs(lines)).toEqual([
			[0, 5],
			[5, 10]
		]);

		// The ParsedLine contract, stated for intent: each span equals its own bytes
		// and the stream is gap-free from 0. The stale-offset bug broke the first.
		let cursor = 0;
		for (const line of lines) {
			expect(line.start).toBe(cursor);
			expect(line.end).toBe(cursor + line.raw.length);
			cursor = line.end;
		}
	});
});
