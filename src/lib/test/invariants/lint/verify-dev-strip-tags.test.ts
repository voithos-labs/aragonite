// Miss-analysis: no test read the tag list, so a check whose `code` repeats its tag fell out unseen.
import { describe, expect, it } from 'vitest';
import { checkTags, checkTagsIn } from '../../../../../scripts/pack/verify-dev-strip.mjs';

describe('the tags the dev-strip check looks for in a production build', () => {
	it('keeps a tag a check also spells as its code', () => {
		const call = "assertInvariant('kept-tag', () => check());";
		const predicate = "return { code: 'kept-tag', message: 'stale' };";
		expect(checkTagsIn([call, predicate])).toEqual(['kept-tag']);
	});

	it('drops a tag another string spells, which a build could carry without the check', () => {
		expect(checkTagsIn(["devWarn('shared', 'x');", "const label = 'shared';"])).toEqual([]);
	});

	it('lists a library check whose predicate names its code', () => {
		expect(checkTags('src/lib')).toContain('range-holds-whole');
	});
});
