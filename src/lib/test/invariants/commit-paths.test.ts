import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { checkCommitPathAddressable } from '$lib/invariants/commit-paths';
import { asDocPath } from '$lib/selection/path-math';

// Doc shape: [paragraph, blockquote[list[item, item]]]
const doc = parse('pad\n\n> - one\n> - two\n');

// asDocPath is an unchecked boundary mint, so the runtime guard is what validates the
// dialect — a minted-but-invalid path still gets rejected.
const check = (path: number[], role: 'eventPath' | 'snapshot.path') =>
	checkCommitPathAddressable(doc, asDocPath(path), role);

describe('checkCommitPathAddressable (G1.16)', () => {
	it('accepts a resolving deep path and the doc root', () => {
		expect(check([1, 0, 1], 'eventPath')).toBeNull();
		expect(check([], 'eventPath')).toBeNull();
	});

	it('accepts the one-past-end insert slot at any depth', () => {
		expect(check([2], 'snapshot.path')).toBeNull();
		expect(check([1, 0, 2], 'eventPath')).toBeNull();
	});

	it('rejects a final index past the insert slot', () => {
		expect(check([3], 'eventPath')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 0 }
		});
	});

	it('rejects the append slot when it is not the final hop (prefix strictness)', () => {
		// The append slot is legal as a FINAL index but not as a prefix, so this is the
		// fixture that fails if the one-past-end allowance leaks to every hop.
		expect(check([2, 0], 'eventPath')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 0 }
		});
	});

	it('rejects a childless final hop reached through several resolving prefixes', () => {
		// Every prefix resolves down to a leaf paragraph, so only the final index dangles.
		expect(check([1, 0, 1, 0, 5], 'snapshot.path')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 4 }
		});
	});

	it('rejects a path descending into a childless leaf', () => {
		expect(check([0, 0], 'eventPath')).toMatchObject({
			code: 'commit-path-dialect',
			detail: { failedAt: 1 }
		});
	});

	it('rejects a negative index', () => {
		expect(check([-1], 'snapshot.path')).toMatchObject({
			code: 'commit-path-dialect'
		});
	});
});
