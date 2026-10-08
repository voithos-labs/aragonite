// For every character, the scanner's switch runs exactly the handler the built-in trigger
// table (`core/inline/scan/triggers.ts`) lists for it, so the two cannot drift apart.
import { describe, expect, it, vi } from 'vitest';
import { scanInline } from '#lib/core/inline/scan/index.js';
import { BUILTIN_TRIGGERS } from '#lib/core/inline/scan/triggers.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

const calls = vi.hoisted(() => [] as { handler: unknown; pos: number }[]);

const recordHandlers = vi.hoisted(
	() => (module: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(module).map(([name, value]) => {
				if (!name.startsWith('handle') || typeof value !== 'function') return [name, value];
				const recorded = (ctx: { pos: number }) => {
					calls.push({ handler: recorded, pos: ctx.pos });
					return value(ctx);
				};
				return [name, recorded];
			})
		)
);

vi.mock('#lib/core/inline/scan/autolinks.js', async (original) => recordHandlers(await original()));
vi.mock('#lib/core/inline/scan/brackets.js', async (original) => recordHandlers(await original()));
vi.mock('#lib/core/inline/scan/code-spans.js', async (original) =>
	recordHandlers(await original())
);
vi.mock('#lib/core/inline/scan/emphasis.js', async (original) => recordHandlers(await original()));
vi.mock('#lib/core/inline/scan/simple-nodes.js', async (original) =>
	recordHandlers(await original())
);

// The handler the scan loop ran at offset 1 of `[` + char; the `[` defeats the fast bail.
function handlerRunOn(char: string): unknown {
	calls.length = 0;
	scanInline(`[${char}`, 0, 2, undefined, defaultGrammarView);
	return calls.find((call) => call.pos === 1)?.handler;
}

describe('built-in trigger dispatch', () => {
	// The fast bail's lookup array covers ASCII only, so a longer or wider key would never scan.
	it('keys every trigger by one ASCII character', () => {
		const misfits = [...BUILTIN_TRIGGERS.keys()].filter(
			(char) => char.length !== 1 || char.charCodeAt(0) >= 128
		);
		expect(misfits).toEqual([]);
	});

	it('runs the table row handler for each trigger and none for any other character', () => {
		const ascii = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code));
		const chars = new Set([...ascii, 'é', ...BUILTIN_TRIGGERS.keys()]);
		const drift = [...chars].filter(
			(char) => handlerRunOn(char) !== BUILTIN_TRIGGERS.get(char)?.handler
		);
		expect(drift.map((char) => JSON.stringify(char))).toEqual([]);
	});

	it('records a handler for a table trigger, so the comparison above is not vacuous', () => {
		expect(handlerRunOn('*')).toBeTypeOf('function');
		expect(handlerRunOn('a')).toBeUndefined();
	});
});
