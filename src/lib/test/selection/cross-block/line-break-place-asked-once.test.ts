// @vitest-environment jsdom
// A line break over a range asks the range-edit core for its place once a keydown: the claim's
// answer is the one the gesture runs on, while the document still holds the bytes it read.
// Miss-analysis: the cost rows counted what one core answer reads, never how many answers a
// keydown asked for, so a claim and a gesture that each asked passed them all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeKeydownEnv, press } from './keydown-env';
import { rangeOwnsKey } from '#lib/selection/cross-block/keydown.js';
import type { CrossBlockDispatchContext } from '#lib/selection/cross-block/dispatch.js';
import type { SelectionEndpoint } from '#lib/selection/primitives.js';

const asks = vi.hoisted(() => ({ count: 0 }));
vi.mock('#lib/range-edit/edit-range.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/range-edit/edit-range.js')>();
	return {
		...actual,
		editRange: (...args: Parameters<typeof actual.editRange>) => {
			asks.count++;
			return actual.editRange(...args);
		}
	};
});

const WHOLE = 'first\n\n***\n\n# head\n\nlast\n';
const TEXT = 'alpha\n\nbeta\n\ngamma\n';

const RANGES: Record<string, { source: string; from: SelectionEndpoint; to: SelectionEndpoint }> = {
	'whole blocks': {
		source: WHOLE,
		from: { path: [1], wholeBlock: true },
		to: { path: [2], offset: 6 }
	},
	'text at both ends': {
		source: TEXT,
		from: { path: [0], offset: 2 },
		to: { path: [2], offset: 2 }
	}
};

function rangeOver(name: keyof typeof RANGES) {
	const { source, from, to } = RANGES[name];
	const env = makeKeydownEnv(source);
	env.selection.enterCrossBlock(from, to);
	return env;
}

/** The claim the host and the containers the key bubbles through ask first, then the handler. */
async function pressThrough(env: ReturnType<typeof rangeOver>, event: KeyboardEvent) {
	for (let asker = 0; asker < 3; asker++) rangeOwnsKey(event, env.ctx);
	await env.keydown.handleKeyDown(event);
}

beforeEach(() => {
	asks.count = 0;
});

describe('a line break over a range asks for its place once a keydown', () => {
	for (const range of Object.keys(RANGES))
		for (const [name, init] of [
			['Enter', {}],
			['Shift+Enter', { shiftKey: true }]
		] as const) {
			it(`${name} over ${range}`, async () => {
				const env = rangeOver(range);
				const before = env.source();
				await pressThrough(env, press('Enter', init));

				expect(env.source()).not.toBe(before);
				expect(asks.count).toBe(1);
			});
		}

	it('a claim whose bytes changed before the gesture ran is asked again, never used', async () => {
		const env = rangeOver('whole blocks');
		const event = press('Enter');
		rangeOwnsKey(event, env.ctx);
		// The document moves between the claim and the gesture, as a composition's write or a second
		// key's would: the claim's answer, landed on these bytes, would put `last` back.
		const { blockEdit } = env.ctx as CrossBlockDispatchContext;
		await blockEdit.updateBlockContent(3, 'later\n', 'authored', 'join-typing', 4, 5);
		await env.keydown.handleKeyDown(event);

		expect(env.source()).toBe('first\n\n\nlater\n');
		expect(asks.count).toBe(2);
	});

	it('a claim whose range moved before the gesture ran is asked again, never used', async () => {
		const env = rangeOver('text at both ends');
		const event = press('Enter');
		rangeOwnsKey(event, env.ctx);
		// A handler between the claim and the gesture selects another range and leaves the key.
		env.selection.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 2 });
		await env.keydown.handleKeyDown(event);

		const fresh = makeKeydownEnv(TEXT);
		fresh.selection.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 2 });
		await fresh.keydown.handleKeyDown(press('Enter'));
		expect(env.source()).toBe(fresh.source());
		expect(env.source()).toContain('gamma');
	});
});
