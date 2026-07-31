// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '$lib';
import { parseInline } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_TEXT } from '$lib/core/directive/kinds';
import { resetPluginPlatformForTests } from '$lib/testing';
import { emojiPlugin, EMOJI_KIND } from '$lib/plugins/emoji';

// Both grammars ride the bare `:` trigger, and register-once forbids the same
// (trigger, prefix, priority) twice — so emoji's `plugin + 10` rung is what lets them
// coexist. The grammars are disjoint, so the order decides first refusal only.
beforeEach(() => {
	resetPluginPlatformForTests();
	activateDirectiveGrammar();
	installPlugins([emojiPlugin()]);
});
afterEach(() => resetPluginPlatformForTests());

const scan = (raw: string) => parseInline(raw, 0, raw.length);
const kindsIn = (raw: string) => scan(raw).map((n: InlineNode) => n.kind);

describe('emoji and the directive text tier coexist on `:`', () => {
	it('a bare :smile: is an emoji — the directive rung declined it', () => {
		const emoji = scan(':smile:').find((n) => n.kind === EMOJI_KIND);
		expect(emoji).toMatchObject({ start: 0, end: 7, decoded: '😄' });
	});

	it(':name[label]{.cls} stays a directive — emoji never sees a closing colon', () => {
		const nodes = scan(':name[label]{.cls}');
		expect(nodes[0].kind).toBe(DIRECTIVE_TEXT);
		expect(kindsIn(':name[label]{.cls}')).not.toContain(EMOJI_KIND);
	});

	it('a bare :name is literal — neither rung claims it', () => {
		expect(kindsIn(':name')).toEqual(['text']);
	});

	// A table miss declines to bytes rather than being claimed by the +10 rung — the
	// directive tier already had first refusal, so a miss leaves ordinary prose.
	it('an unknown :notaname: stays literal after both rungs decline', () => {
		expect(kindsIn(':notaname:')).toEqual(['text']);
	});
});

// The other install order a consumer can write: emoji claims `:` first, so an
// activation asking "does anyone own `:`" rather than "did I already register" skips
// its own recognizer and leaves the tier dead. Byte round-trip is blind to it.
describe('the directive text tier survives a plugin that took `:` first', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([emojiPlugin()]);
		activateDirectiveGrammar();
	});

	it('recognizes :name[label] with emoji already on the trigger', () => {
		expect(scan(':name[label]')[0].kind).toBe(DIRECTIVE_TEXT);
	});

	it('leaves emoji claiming its own shortcodes', () => {
		expect(scan(':smile:').find((n) => n.kind === EMOJI_KIND)).toBeDefined();
	});
});

describe('resetPluginPlatformForTests reaches the emoji registration', () => {
	it('clears the `:` rung so a re-install does not throw on a duplicate', () => {
		resetPluginPlatformForTests();
		expect(() => installPlugins([emojiPlugin()])).not.toThrow();
		expect(scan(':smile:').find((n) => n.kind === EMOJI_KIND)).toBeDefined();
	});
});
