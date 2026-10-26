/** Which `test.fixme` calls the shared e2e `test` hands to Playwright, and which it runs anyway. */
import { describe, it, expect, vi } from 'vitest';
import { withFixmeRerun } from '../../e2e/fixme-rerun';

function fakeTest(inTest: boolean) {
	const annotations: { type: string; description?: string }[] = [];
	const playwrightFixme = vi.fn();
	const test = {
		fixme: playwrightFixme as (...args: never[]) => void,
		info: () => {
			if (!inTest) throw new Error('test.info() can only be called while test is running');
			return { annotations };
		}
	};
	return { test, playwrightFixme, annotations };
}

const call = (test: { fixme: (...args: never[]) => void }, args: unknown[]) =>
	(test.fixme as (...args: unknown[]) => void)(...args);

describe('withFixmeRerun', () => {
	it('without E2E_RERUN_FIXME, returns the test untouched', () => {
		const { test, playwrightFixme } = fakeTest(true);
		expect(withFixmeRerun(test, {})).toBe(test);
		expect(test.fixme).toBe(playwrightFixme);
	});

	it.each([
		['a declared fixme test', true, ['#1: title', () => {}]],
		['a bare fixme', true, []],
		['a conditional fixme outside a test', false, [true, '#1: reason']]
	])('under E2E_RERUN_FIXME, %s still goes to Playwright', (_, inTest, args) => {
		const { test, playwrightFixme, annotations } = fakeTest(inTest);
		call(withFixmeRerun(test, { E2E_RERUN_FIXME: '1' }), args);
		expect(playwrightFixme).toHaveBeenCalledWith(...args);
		expect(annotations).toEqual([]);
	});

	it.each([
		[true, [{ type: 'fixme-rerun', description: '#1: reason' }]],
		[false, []]
	])('under E2E_RERUN_FIXME, an in-test fixme(%s, reason) runs the test', (condition, recorded) => {
		const { test, playwrightFixme, annotations } = fakeTest(true);
		call(withFixmeRerun(test, { E2E_RERUN_FIXME: '1' }), [condition, '#1: reason']);
		expect(playwrightFixme).not.toHaveBeenCalled();
		expect(annotations).toEqual(recorded);
	});
});
