// @vitest-environment jsdom
// Over a live range, a key no keymap binds to an indent command never walks the range, and a key
// one does walks it once per keydown, however many containers and handlers ask.
// Miss-analysis: every indent-key row checked what a key did, never what it cost, so a walk of the
// whole range on every arrow and typed key passed them all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeKeydownEnv, press, type KeydownEnvOptions } from './keydown-env';
import { rangeOwnsKey } from '#lib/selection/cross-block/keydown.js';

const walks = vi.hoisted(() => ({ count: 0 }));
vi.mock('#lib/selection/cross-block/range-indent.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('#lib/selection/cross-block/range-indent.js')>();
	return {
		...actual,
		coversIndentBinding: (...args: Parameters<typeof actual.coversIndentBinding>) => {
			walks.count++;
			return actual.coversIndentBinding(...args);
		}
	};
});

const SOURCE = '- alpha\n- beta\n- gamma\n';

function rangeOver(options: KeydownEnvOptions) {
	const env = makeKeydownEnv(SOURCE, { myPath: [0, 2, 0], ...options });
	env.selection.enterCrossBlock({ path: [0, 1, 0], offset: 1 }, { path: [0, 2, 0], offset: 2 });
	return env;
}

/** The containers the key bubbles through ask first, then the range's own handler. */
async function pressThrough(env: ReturnType<typeof rangeOver>, event: KeyboardEvent) {
	for (let container = 0; container < 3; container++) rangeOwnsKey(event, env.ctx);
	await env.keydown.handleKeyDown(event);
}

beforeEach(() => {
	walks.count = 0;
});

describe('reading an indent key over a range', () => {
	for (const [name, key, init] of [
		['F7', 'F7', {}],
		['a typed letter', 'a', {}],
		['Shift+ArrowDown', 'ArrowDown', { shiftKey: true }],
		['Escape', 'Escape', {}]
	] as const) {
		it(`${name}, bound to nothing that indents, walks nothing`, async () => {
			const env = rangeOver({});
			await pressThrough(env, press(key, init));

			expect(walks.count).toBe(0);
		});
	}

	it('a key rebound to the list indent walks once and nests both items', async () => {
		const env = rangeOver({
			keybindings: [{ chord: 'Mod+]', command: 'list.indent', kind: 'listItem' }]
		});
		await pressThrough(env, press(']', { ctrlKey: true }));

		expect(walks.count).toBe(1);
		expect(env.source()).toBe('- alpha\n  - beta\n  - gamma\n');
	});
});
