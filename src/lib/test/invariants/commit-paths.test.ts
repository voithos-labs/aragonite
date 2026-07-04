import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { checkCommitPathAddressable } from '$lib/invariants/commit-paths';

// Doc shape: [paragraph, blockquote[list[item, item]]]
const doc = parse('pad\n\n> - one\n> - two\n');

describe('checkCommitPathAddressable (G1.16)', () => {
	it('accepts a resolving deep path and the doc root', () => {
		expect(checkCommitPathAddressable(doc, [1, 0, 1], 'eventPath')).toBeNull();
		expect(checkCommitPathAddressable(doc, [], 'eventPath')).toBeNull();
	});

	it('accepts the one-past-end insert slot at any depth', () => {
		expect(checkCommitPathAddressable(doc, [2], 'snapshot.path')).toBeNull();
		expect(checkCommitPathAddressable(doc, [1, 0, 2], 'eventPath')).toBeNull();
	});

	it('rejects a final index past the insert slot', () => {
		expect(checkCommitPathAddressable(doc, [3], 'eventPath')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 0 }
		});
	});

	it('rejects the append slot when it is not the final hop (prefix strictness)', () => {
		// [2, 0]: index 2 is the doc's append slot — legal as a FINAL index (above)
		// but not as a prefix, which must resolve to a real child. The only fixture
		// that fails if the isLast one-past-end allowance leaks to every hop.
		expect(checkCommitPathAddressable(doc, [2, 0], 'eventPath')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 0 }
		});
	});

	it('rejects a childless final hop reached through several resolving prefixes', () => {
		// [1, 0, 1, 0, 5]: every prefix resolves (blockquote → list → item "two" →
		// its paragraph); the paragraph is a leaf, so the final index has no child.
		expect(checkCommitPathAddressable(doc, [1, 0, 1, 0, 5], 'snapshot.path')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 4 }
		});
	});

	it('rejects a path descending into a childless leaf', () => {
		expect(checkCommitPathAddressable(doc, [0, 0], 'eventPath')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 1 }
		});
	});

	it('rejects a negative index', () => {
		expect(checkCommitPathAddressable(doc, [-1], 'snapshot.path')).toMatchObject({
			code: 'commit-path-dialect'
		});
	});
});
