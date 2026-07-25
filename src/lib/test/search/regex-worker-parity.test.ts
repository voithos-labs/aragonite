import { describe, it, expect } from 'vitest';
import { regexScanWorkerSource } from '../../search/regex-executor';
import { execAll } from '../../search/matcher';

/**
 * The scan worker ships as source text through a Blob URL, so it cannot import
 * `execAll` and carries its own copy of the loop. This runs both over the same
 * inputs and fails the day they diverge — the duplication's guard.
 */

interface WorkerReply {
	epoch: number;
	ok: boolean;
	ranges?: { start: number; end: number; groups?: string[] }[][];
}

function runWorkerSource(texts: string[], pattern: string, flags: string): WorkerReply {
	let reply: WorkerReply | undefined;
	const fakeSelf = {
		onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
		postMessage: (message: WorkerReply) => {
			reply = message;
		}
	};
	// The worker body is a string by construction; evaluating it here is the only
	// way to test the code that actually ships.
	new Function('self', regexScanWorkerSource)(fakeSelf);
	fakeSelf.onmessage!({ data: { texts, pattern, flags, epoch: 3 } });
	return reply!;
}

// Shapes that have historically separated two implementations of this loop:
// zero-width matches, capture groups, unicode, anchors, and no-match texts.
const CASES: { name: string; texts: string[]; pattern: string; flags: string }[] = [
	{ name: 'plain repeated match', texts: ['ab ab ab'], pattern: 'ab', flags: 'g' },
	{ name: 'zero-width match at every boundary', texts: ['abc'], pattern: 'x*', flags: 'g' },
	{ name: 'capture groups', texts: ['2026-07-25'], pattern: '(\\d{4})-(\\d{2})', flags: 'g' },
	{
		name: 'optional group that does not participate',
		texts: ['ac'],
		pattern: 'a(b)?c',
		flags: 'g'
	},
	{ name: 'case-insensitive', texts: ['Cat cat CAT'], pattern: 'cat', flags: 'gi' },
	{ name: 'non-ascii', texts: ['naïve café naïve'], pattern: 'naïve', flags: 'g' },
	{ name: 'end anchor', texts: ['aaab', 'aaa'], pattern: 'a+$', flags: 'g' },
	{ name: 'no match at all', texts: ['nothing here'], pattern: 'zzz', flags: 'g' },
	{ name: 'several texts at once', texts: ['ab', '', 'ab ab'], pattern: 'ab', flags: 'g' }
];

describe('scan worker parity with execAll', () => {
	for (const { name, texts, pattern, flags } of CASES) {
		it(`agrees on ${name}`, () => {
			const reply = runWorkerSource(texts, pattern, flags);
			expect(reply.ok).toBe(true);
			expect(reply.epoch).toBe(3);
			expect(reply.ranges).toEqual(texts.map((t) => execAll(new RegExp(pattern, flags), t)));
		});
	}

	it('reports an uncompilable pattern instead of throwing out of onmessage', () => {
		expect(runWorkerSource(['text'], '(', 'g')).toEqual({ epoch: 3, ok: false });
	});
});
