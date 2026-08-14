// @vitest-environment jsdom
//
// G4.40 — "single-block rewrite" is spelled in three places and must name one set: the ids the
// built-in keymaps bind, the ids the dispatch seam declines over a cross-block range
// (`SINGLE_BLOCK_RANGE_COMMAND_IDS`), and the chords `cross-block/keydown.ts` swallows before its
// delete-and-redispatch arm. A sixth rewrite taught to one spelling is an N-1 gap at the other
// two. The swallow GROWING a chord is caught by G4.29 instead, off the key literals its
// manifest records.
import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS } from '$lib/core/nodes';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { SINGLE_BLOCK_RANGE_COMMAND_IDS } from '$lib/schema/commands';
import { normalizeChord } from '$lib/schema/keybindings';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

/** Set members whose id carries no `format.` prefix. Hand-carried because membership is the
 *  arm's shape and no naming rule separates them from the kind commands beside them: a prefix
 *  census could not see `link.openCard`, which is how it stayed outside the set. */
const NON_FORMAT_REWRITE_IDS = ['link.openCard'];

const isSingleBlockRewriteId = (command: string): boolean =>
	command.startsWith('format.') || NON_FORMAT_REWRITE_IDS.includes(command);

/** Every chord the built-in kind keymaps bind to a single-block rewrite, deduplicated. */
function singleBlockRewriteKeymap(): Array<{ chord: string; command: string }> {
	const rows = new Map<string, { chord: string; command: string }>();
	for (const kind of ALL_BLOCK_KINDS) {
		for (const binding of tryGetBlockKindDescriptor(kind)?.keymap ?? []) {
			if (!isSingleBlockRewriteId(binding.command)) continue;
			const chord = normalizeChord(binding.chord);
			rows.set(`${chord} ${binding.command}`, { chord, command: binding.command });
		}
	}
	return [...rows.values()].sort((a, b) => a.chord.localeCompare(b.chord));
}

/** The event a browser sends for `chord`. Only single letters case-fold, as `normalizeKey` does;
 *  a named key (`Enter`) travels verbatim. */
function pressChord(chord: string): KeyboardEvent {
	const parts = chord.split('+');
	const key = parts.pop()!;
	const shiftKey = parts.includes('Shift');
	const eventKey = key.length === 1 ? (shiftKey ? key.toUpperCase() : key.toLowerCase()) : key;
	return press(eventKey, {
		ctrlKey: parts.includes('Mod'),
		altKey: parts.includes('Alt'),
		shiftKey
	});
}

async function pressOverCrossBlockRange(chord: string) {
	const env = makeKeydownEnv(SOURCE);
	env.selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });
	const event = pressChord(chord);
	const consumed = await env.keydown.handleKeyDown(event);
	return { consumed, event, source: env.source() };
}

describe('G4.40 single-block-rewrite set parity', () => {
	const keymap = singleBlockRewriteKeymap();

	it('the keymaps bind exactly the ids the seam declines over a range', () => {
		const bound = [...new Set(keymap.map((row) => row.command))].sort();
		expect(bound).toEqual([...SINGLE_BLOCK_RANGE_COMMAND_IDS].sort());
	});

	it.each(keymap)('$chord ($command) is swallowed over a cross-block range', async ({ chord }) => {
		const { consumed, event, source } = await pressOverCrossBlockRange(chord);
		expect(consumed).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(source).toBe(SOURCE);
	});

	// Non-vacuity: the arm claims the rewrites, not every modified chord the keymaps bind.
	it('a keymap chord outside the set is not swallowed by the rewrite arm', async () => {
		const { consumed, event } = await pressOverCrossBlockRange('Mod+Enter');
		expect(consumed).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});

	it('the chord→event translation carries the modifiers it names', () => {
		expect(pressChord('Mod+Shift+X')).toMatchObject({
			key: 'X',
			ctrlKey: true,
			shiftKey: true,
			altKey: false
		});
		expect(pressChord('Mod+B')).toMatchObject({ key: 'b', ctrlKey: true, shiftKey: false });
		expect(pressChord('Mod+Shift+Enter')).toMatchObject({ key: 'Enter', shiftKey: true });
	});
});
