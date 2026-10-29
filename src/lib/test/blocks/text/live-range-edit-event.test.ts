// @vitest-environment jsdom
// What `resolveLiveRangeEdit` makes of the range an InputEvent carries. The joins are covered
// through `replaceRangeInLeaf`; a collapsed insert is `typed-insert.test.ts`'s.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import {
	resolveLiveRangeEdit,
	type LiveEditCursor
} from '#lib/components/blocks/text/live-selection-edit.js';
import { fixtureReading, topLevelStore } from '../../harness/fixture-grammar';

const LINK = 'Some [ab](u)text\n';

/** An `insertText` whose browser target is a collapsed static range. */
function insertEvent(data: string): InputEvent {
	const e = new InputEvent('beforeinput', { inputType: 'insertText', data, cancelable: true });
	Object.defineProperty(e, 'getTargetRanges', {
		value: () => [{ collapsed: true } as StaticRange]
	});
	return e;
}

describe('a collapsed insertion in live mode', () => {
	it('is left to the step after this one, with no raw read of its target', () => {
		const node = parse(LINK).children[0];
		const reads: string[] = [];
		const cursor: LiveEditCursor = {
			rawRangeOf: () => {
				reads.push('target');
				return { start: 8, end: 8 };
			},
			getRawSelection: () => null
		};
		const store = topLevelStore(node, fixtureReading({}, 'live'));
		expect(resolveLiveRangeEdit(insertEvent(' '), node, cursor, store)).toBeNull();
		expect(reads).toEqual([]);
	});
});
