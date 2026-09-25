import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parse } from '$lib/core/parser';
import { createSharingState } from '$lib/tree-operations/sharing';
import { ensureUnsharedPath } from '$lib/tree-operations/unshare';
import { rebuildUnsharedChain } from '$lib/tree-operations/chain-rebuild';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';
import { defaultGrammarView } from '$lib/schema/block-openers';

// Re-deriving a container's kind costs a `parse` of its whole raw, so it happens only when
// the first line changed and that line's opener answer changed with it. The second condition is
// what keeps the cost of a keystroke off the container-size axis: typing into a list's first
// item rewrites the opener line without changing any answer.

const KEYSTROKES = 20;

/** Type `count` characters into the leaf at `leafPath`, one rebuild each. */
function typeInto(source: string, leafPath: number[], count: number): void {
	const doc = parse(source);
	const sharing = createSharingState();
	let text = '';
	for (let i = 0; i < count; i++) {
		text += 'x';
		const chain = ensureUnsharedPath(doc, leafPath, sharing);
		chain[chain.length - 1].raw = `${text}\n`;
		rebuildUnsharedChain(doc, chain, sharing, null, defaultGrammarView);
	}
}

const reparses = () => perfSnapshot().containerKindReparses;

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(() => disablePerfInstruments());

describe('container kind re-derivation gate', () => {
	it('reparses nothing while typing outside the container opener line', () => {
		typeInto('> head\n>\n> body\n', [0, 1], KEYSTROKES);

		expect(perfSnapshot().rebuildDepths).toEqual({ 2: KEYSTROKES });
		expect(reparses()).toBe(0);
	});

	// The first condition passes and the second holds: each of these rewrites the container's
	// opener line on every keystroke while the opener's answer stays the same. These are the rows
	// that put the cost on the container-size axis when only the first condition exists.
	it.each([
		['blockquote first paragraph', '> head\n>\n> body\n', [0, 0]],
		['list first item', '- one\n- two\n- three\n', [0, 0, 0]]
	])('reparses nothing while typing into the %s', (_label, source, leafPath) => {
		typeInto(source, leafPath, KEYSTROKES);

		expect(reparses()).toBe(0);
	});

	// A directive's opener declines when shown one line (it wants its `:::` closer), so the
	// second condition can never confirm it and only the first holds here. Typing costs nothing:
	// that line carries only the directive name.
	it('reparses nothing while typing into a directive container body', () => {
		typeInto(':::spoiler\n\nbody\n\n:::\n', [0, 0], KEYSTROKES);

		expect(reparses()).toBe(0);
	});

	// Only the keystroke that closes the marker changes the answer. The trailing `x` keeps one
	// keystroke after that in the run, so a check that stayed open once opened over-counts here.
	it('reparses only on the keystroke that moves the opener verdict', () => {
		const doc = parse('> [!TI\n');
		const sharing = createSharingState();
		let text = '[!TI';
		for (const char of 'P]x') {
			text += char;
			const chain = ensureUnsharedPath(doc, [0, 0], sharing);
			chain[chain.length - 1].raw = `${text}\n`;
			rebuildUnsharedChain(doc, chain, sharing, null, defaultGrammarView);
		}

		expect(doc.children[0].kind).toBe('githubAlert');
		expect(reparses()).toBe(1);
	});
});
