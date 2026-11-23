// @vitest-environment node
// Miss-analysis: the maker's fixed-fence rule was only ever handed a body line spelling its closer,
// never a write that cut the closing line, so a block that fell back to a paragraph went unseen.
// The rows are the `$$` block's own rule as the latex package wrote it, which this rule replaces.
import { describe, expect, it } from 'vitest';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import { makingOf } from '#lib/schema/block-type.js';
import type { WriteContext, WriteRule } from '#lib/schema/block-kind-descriptor.js';
import type { Fence } from '#lib/schema/block-shapes.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';

function ruleOf(fence: Fence): WriteRule {
	const type = fencedBlock({
		name: 'fixed',
		label: 'Fixed',
		sample: '$$\nx\n$$',
		insert: { none: 'a fixture of the write rule rows' },
		fence
	});
	return makingOf(type)!.registration.rawWrite!;
}

const ctxOf = (raw: string, mode: WriteContext['mode']): WriteContext => ({
	node: { kind: 'demo/fixed', raw, leadingTrivia: '' } as WriteContext['node'],
	mode,
	lineEnding: raw.includes('\r\n') ? '\r\n' : '\n'
});

const dollars = ruleOf({ open: /^\$\$$/, close: '$$' });

describe('a fixed fence write', () => {
	it.each([
		['a cut closing line comes back', '$$\nx\n$$\n', '$$\nx\n', '$$\nx\n$$\n', 5],
		['a cut down to the opener', '$$\nx\n$$\n', '$$\n', '$$\n$$\n', 3],
		['a cut with no final line ending', '$$\nx\n$$', '$$\nx', '$$\nx\n$$', 4],
		['a cut written with no line ending', '$$\nx\n$$\n', '$$\nx', '$$\nx\n$$', 4],
		['a cut in CRLF', '$$\r\nx\r\n$$\r\n', '$$\r\nx\r\n', '$$\r\nx\r\n$$\r\n', 7],
		['text typed onto the closing line', '$$\nx\n$$\n', '$$\nx\n$$ y\n', '$$\nx\n$$ y\n$$\n', 10],
		['a closed write stays', '$$\nx\n$$\n', '$$\nx\ny\n$$\n', '$$\nx\ny\n$$\n', 10],
		[
			'a second closer past the first stays',
			'$$\nx\n$$\n',
			'$$\nx\n$$\n$$\n',
			'$$\nx\n$$\n$$\n',
			11
		],
		['a cut opener leaves the rest', '$$\nx\n$$\n', 'x\n$$\n', 'x\n$$\n', 5]
	])('%s', (_name, node, written, legal, offset) => {
		for (const mode of ['authored', 'literal'] as const) {
			const ctx = ctxOf(node, mode);
			expect(dollars.normalize(written, ctx)).toBe(legal);
			expect(dollars.mapOffset(written, written.length, ctx)).toBe(offset);
		}
	});

	it('escapes a body line spelling the closer, and a caret past the escape moves with it', () => {
		const rule = ruleOf({ open: /^@@@$/, close: '@@@', escape: (line) => `\\${line}` });
		const ctx = ctxOf('@@@\nx\n@@@\n', 'literal');
		const written = '@@@\n@@@\nx\n@@@\n';
		expect(rule.normalize(written, ctx)).toBe('@@@\n\\@@@\nx\n@@@\n');
		const mapped = [4, 6, 9].map((offset) => rule.mapOffset(written, offset, ctx));
		expect(mapped).toEqual([4, 7, 10]);
	});

	it('warns where an escape leaves the line reading as the closer', () => {
		const rule = ruleOf({ open: /^@@@$/, close: '@@@', escape: (line) => line });
		const written = '@@@\n@@@\nx\n@@@\n';
		expect(rule.normalize(written, ctxOf('@@@\nx\n@@@\n', 'literal'))).toBe(written);
		expect(takeDevWarnsOf('fence-escape')).toHaveLength(1);
	});
});
