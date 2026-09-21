// @vitest-environment jsdom
//
// The set of single-block rewrites is spelled in three places (the built-in keymaps, the command
// dispatcher's range lists, the chords `cross-block/keydown.ts` handles) and the three must agree:
// a sixth rewrite taught to one spelling is a gap at the other two (G4.40). The dispatcher's lists
// may hold a non-rewrite id too (`heading.cycle`); G4.29 catches a chord growing.
import { describe, it, expect } from 'vitest';
import { ALL_BLOCK_KINDS } from '$lib/core/nodes';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { CROSS_BLOCK_RANGE_COMMAND_IDS, RANGE_DECLINED_COMMAND_IDS } from '$lib/schema/commands';
import { normalizeChord } from '$lib/schema/keybindings';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

/** Set members whose id carries no `format.` prefix. Listed by hand because no naming rule
 *  separates them from the kind commands beside them: a prefix scan could not see
 *  `link.openCard`, which is how it stayed outside the set. */
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

	it('the keymaps bind exactly the rewrite ids the join answers specially over a range', () => {
		const bound = [...new Set(keymap.map((row) => row.command))].sort();
		// Scoped to the rewrites: the dispatcher declines the heading commands too, but their chords
		// reach it through the delete-and-redispatch branch, so no rewrite chord names them.
		const answered = [...RANGE_DECLINED_COMMAND_IDS, ...CROSS_BLOCK_RANGE_COMMAND_IDS]
			.filter(isSingleBlockRewriteId)
			.sort();
		expect(bound).toEqual(answered);
	});

	it.each(keymap)('$chord ($command) is claimed over a cross-block range', async ({ chord }) => {
		const { consumed, event } = await pressOverCrossBlockRange(chord);
		expect(consumed).toBe(true);
		expect(event.defaultPrevented).toBe(true);
	});

	it.each(keymap.filter((row) => RANGE_DECLINED_COMMAND_IDS.has(row.command)))(
		'$chord ($command) writes nothing: the range has no one block for its arm',
		async ({ chord }) => {
			expect((await pressOverCrossBlockRange(chord)).source).toBe(SOURCE);
		}
	);

	it.each(keymap.filter((row) => CROSS_BLOCK_RANGE_COMMAND_IDS.has(row.command)))(
		'$chord ($command) reaches the cross-block arm and rewrites both endpoints',
		async ({ chord }) => {
			const { source } = await pressOverCrossBlockRange(chord);
			expect(source).not.toBe(SOURCE);
			// The anchor block's tail and the focus block's head, each marked on its own.
			expect(source.startsWith('a')).toBe(true);
			expect(source.endsWith('gamma\n')).toBe(true);
		}
	);

	// Non-vacuity: the branch handles the rewrites, not every modified chord the keymaps bind.
	it('a keymap chord outside the set is not swallowed by the rewrite branch', async () => {
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
