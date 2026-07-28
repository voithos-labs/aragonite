import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parse } from '$lib/core/parser';
import { createSharingState } from '$lib/tree-operations/sharing';
import { ensureUnsharedPath, rebuildUnsharedChain } from '$lib/tree-operations/unshare';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';

// The kind re-derivation costs a container reparse, so it is gated on the
// container's FIRST line changing across its rebuild. An opener claims from line 1,
// so this drops the reparse for every keystroke outside the opener line — which is
// where ordinary typing lives — while a marker completing on line 1 still reaches it.

const KEYSTROKES = 20;

/** Type `count` characters into the container's leaf at `leafIndex`, one commit each. */
function typeInto(source: string, leafIndex: number, count: number): void {
	const doc = parse(source);
	const sharing = createSharingState();
	let text = '';
	for (let i = 0; i < count; i++) {
		text += 'x';
		const chain = ensureUnsharedPath(doc, [0, leafIndex], sharing);
		chain[chain.length - 1].raw = `${text}\n`;
		rebuildUnsharedChain(doc, chain, sharing);
	}
}

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
		typeInto('> head\n>\n> body\n', 1, KEYSTROKES);

		expect(perfSnapshot().rebuildDepths).toEqual({ 2: KEYSTROKES });
		expect(perfSnapshot().containerKindReparses).toBe(0);
	});

	// The unavoidable arm: an edit to the opener line is exactly the edit that can
	// change what the container opens as, so each of these keystrokes pays a reparse.
	it('reparses once per keystroke that rewrites the opener line', () => {
		typeInto('> head\n>\n> body\n', 0, KEYSTROKES);

		expect(perfSnapshot().containerKindReparses).toBe(KEYSTROKES);
	});

	// The worst case, recorded rather than inferred: a reserved-chrome container keeps
	// its title's bytes IN the opener line, so typing a title is opener-line typing —
	// the gate never elides it. Bounded by the container's own subtree, which its raw
	// rebuild already walks per keystroke.
	it('reparses on every keystroke into a reserved-chrome title', () => {
		typeInto(':::note Title\n\nbody\n\n:::\n', 0, KEYSTROKES);

		expect(perfSnapshot().containerKindReparses).toBe(KEYSTROKES);
	});
});
