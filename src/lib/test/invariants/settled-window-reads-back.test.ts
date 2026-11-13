// G1.145: the blocks a fix-up re-divided read back as themselves with the blocks around them.
// G1.214: so does a block a keystroke wrote in place.
// Miss-analysis: the check read one block either side, so a definition two blocks above a window
// was never in the read, and nothing at all read a block written in place.
import { describe, it, expect } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import {
	checkSettledWindowReadsBack,
	checkWrittenInPlaceReadsBack
} from '#lib/invariants/settled-window-reads-back.js';
import { READ_BACK_LIMIT } from '#lib/invariants/reads-back.js';

const body = (children: CstNode[]) => ({ children, owner: undefined, lineEnding: '\n' as const });
const fence = (raw: string, leadingTrivia = ''): CstNode => ({
	...parse(raw).children[0],
	leadingTrivia
});

/** Each of `raws` as the block it reads as alone, standing flush under the one before. */
const flush = (...raws: string[]): CstNode[] =>
	raws.map((raw) => ({ ...parse(raw).children[0], leadingTrivia: '' }));

// A title that starts in the code line and closes in the last, so a reload reads one definition.
const STARTED = ['[a]: /u\n', '    "code\n', '[b]: /v\n', 'end"\n'];
const PADDING = `    ${'x'.repeat(60)}\n`.repeat(Math.ceil(READ_BACK_LIMIT / 65));

describe('G1.145 a window is read out to the blank lines either side', () => {
	it('fails a window two blocks under the definition its bytes close', () => {
		const violation = checkSettledWindowReadsBack(
			body(flush(...STARTED)),
			3,
			3,
			defaultGrammarView
		);

		expect(violation?.code).toBe('settled-window-reads-back');
	});

	it('passes the same blocks once a blank line parts the definition from them', () => {
		const children = flush(...STARTED);
		children[1] = { ...children[1], leadingTrivia: '\n' };

		expect(checkSettledWindowReadsBack(body(children), 3, 3, defaultGrammarView)).toBeNull();
	});

	it('reads a run past the limit with its neighbours alone', () => {
		const children = flush('[a]: /u\n', `    "code\n${PADDING}`, 'end"\n');

		expect(checkSettledWindowReadsBack(body(children), 2, 2, defaultGrammarView)).toBeNull();
	});
});

describe('G1.214 a block written in place reads back with its run', () => {
	it('fails a block whose bytes close a title two blocks above it', () => {
		const violation = checkWrittenInPlaceReadsBack(body(flush(...STARTED)), 3, defaultGrammarView);

		expect(violation?.code).toBe('settled-window-reads-back');
	});

	it('passes a run that reads as it stands', () => {
		const children = flush('[a]: /u\n', '    code\n', '[b]: /v\n', 'end\n');

		expect(checkWrittenInPlaceReadsBack(body(children), 3, defaultGrammarView)).toBeNull();
	});

	it('reads nothing where a blank line stands either side of the block', () => {
		const children = flush(...STARTED).map((node) => ({ ...node, leadingTrivia: '\n' }));

		expect(checkWrittenInPlaceReadsBack(body(children), 3, defaultGrammarView)).toBeNull();
	});

	it('skips a run past the limit', () => {
		const children = flush('[a]: /u\n', `    "code\n${PADDING}`, 'end"\n');

		expect(checkWrittenInPlaceReadsBack(body(children), 2, defaultGrammarView)).toBeNull();
	});
});

describe('G1.145 a settled window reads back as itself', () => {
	it('passes blocks a reload divides the same way', () => {
		const { children } = parse('a\n\n```js\nx\n```\n\nb\n\n```\ny\n```\n');

		expect(checkSettledWindowReadsBack(body(children), 0, 1, defaultGrammarView)).toBeNull();
	});

	it('fails an unclosed fence standing above the block after it', () => {
		const children = [fence('```js\nopen\n'), { ...parse('b\n').children[0], leadingTrivia: '\n' }];

		const violation = checkSettledWindowReadsBack(body(children), 0, 0, defaultGrammarView);
		expect(violation?.code).toBe('settled-window-reads-back');
	});

	it('fails a closer below that pairs with the window otherwise than the tree holds', () => {
		const children = [fence('```js\ncode\n'), fence('```\n\ntext\n\n```py\nx\n```\n')];

		const violation = checkSettledWindowReadsBack(body(children), 0, 0, defaultGrammarView);
		expect(violation?.code).toBe('settled-window-reads-back');
	});
});
