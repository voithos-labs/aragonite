// The writers of a new `$$` block outside the Enter completer (`typed-completion.test.ts` pins
// that one): each builds its bytes from `mathBlockLines` and writes what it always has.
import { describe, expect, it } from 'vitest';
import { makingOf } from '#lib/schema/block-type.js';
import { installPluginList } from '#lib/schema/plugin-unit.js';
import { latex } from '#packages/latex/src/index.js';

const making = () => {
	const [unit] = installPluginList([latex], ({ cause }) => {
		throw cause;
	});
	return makingOf(unit.contribution.blocks![0])!;
};

describe('a new $$ block is written as it always was', () => {
	it('by the insert menu', () => {
		expect(making().insert).toMatchObject({ label: 'Math block', insert: '$$\n\n$$\n' });
	});

	it('by the published checks’ sample', () => {
		expect(making().registration.samples?.[0]).toBe('$$\nx^2\n$$\n');
	});
});
