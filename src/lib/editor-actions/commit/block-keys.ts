/**
 * The answers a surface that reads the rest of the document redraws on: what its `depends(block)`
 * says of each top-level block (a toc, the headings in it; footnote numbering, the references).
 * A watch asks every block once as it starts, then only the blocks a write's runs replaced, and
 * asks them after the write, when the answers are read: a position read inside a write fails a
 * dev build. An answer that says something (not '') coming, going or changing is a change.
 */
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import type { Block, KeyWatch } from '../../schema/doc-view';
import type { TopLevelChange } from '../../tree-operations/top-level-starts';
import { checkKeptKeys } from '../../invariants/kept-keys';
import { perfEnabled, recordKeyAsked } from '../../perf/instruments';
import type { WriteFollower } from './kept-starts';

/** The writes a watch follows and the blocks it asks. */
export interface KeySource {
	follow(follower: WriteFollower): () => void;
	blocks(): readonly Block[];
}

/** Starts asking now; a throw in `depends` reaches `report` and answers ''. */
export function watchKeys(
	source: KeySource,
	depends: (block: Block) => string,
	report: (cause: unknown) => void
): KeyWatch {
	let slots: string[] = [];
	// Handed out, so the next change copies first.
	let shared = false;
	// Each reader keeps the version it last saw, so one watch serves several.
	let version = 0;
	// Null while it follows nothing: the next read asks every block.
	let writes: (readonly TopLevelChange[] | null)[] | null = null;
	let unfollow: (() => void) | null = null;

	const ask = (block: Block): string => {
		recordKeyAsked();
		try {
			return String(depends(block));
		} catch (cause) {
			report(cause);
			return '';
		}
	};

	function follow(): void {
		writes = [];
		unfollow = source.follow({
			heard({ runs }) {
				writes?.push(runs);
				// One nobody reads (its plugin turned off, its drawings gone) lets go, and asks again
				// if it's read.
				if (writes && writes.length > LAPSE) lapse();
			},
			// A write says which blocks it replaced only while the record is measured.
			readsBefore: () => true
		});
	}

	function lapse(): void {
		unfollow?.();
		unfollow = writes = null;
	}

	function askAll(list: readonly Block[], was: readonly string[]): void {
		slots = Array.from({ length: list.length }, (_, i) => ask(list[i]));
		shared = false;
		if (!sameSaying(was, slots)) version++;
	}

	function settle(): void {
		if (!writes) {
			follow();
			askAll(source.blocks(), slots);
			return;
		}
		if (writes.length === 0) return;
		const done = writes;
		writes = [];
		const list = source.blocks();
		const was = slots;
		const moves = done.includes(null) ? null : replaced(done as (readonly TopLevelChange[])[]);
		// A write that couldn't say, or runs that don't add up, ask every block.
		if (!moves || slots.length !== list.length) askAll(list, was);
		else {
			const came: string[] = [];
			let changed = false;
			for (const i of moves.asks) {
				const key = ask(list[i]);
				if (moves.fresh.has(i)) {
					if (key) came.push(key);
				} else if (key !== slots[i]) changed = true;
				if (key === slots[i]) continue;
				if (shared) slots = slots.slice();
				shared = false;
				slots[i] = key;
			}
			// Blocks put in or taken out move only what they say, in order (an Enter in prose, none).
			if (changed || !sameSaying(came, moves.gone)) version++;
		}
		if (devChecksOn && !perfEnabled() && list.length <= CHECKED_UP_TO) {
			assertInvariant('kept-keys', () => checkKeptKeys(slots, list.map(quietly(depends))));
		}
	}

	/** Moves the slots past each write's runs, '' where a block is new, and names the slots to
	 *  ask: `fresh` the new ones, `gone` what the blocks taken out said. */
	function replaced(done: readonly (readonly TopLevelChange[])[]) {
		let asks: number[] = [];
		let fresh: number[] = [];
		const gone: string[] = [];
		for (const runs of done) {
			asks = shiftedPast(asks, runs);
			fresh = shiftedPast(fresh, runs);
			let delta = 0;
			for (const run of runs) {
				const at = run.at + delta;
				if (run.removed !== run.inserted) {
					for (let i = at; i < at + run.removed; i++) if (slots[i]) gone.push(slots[i]);
					const made = new Array<string>(run.inserted).fill('');
					// Joined, never spliced in: a run can put in a document's worth of blocks.
					slots = slots.slice(0, at).concat(made, slots.slice(at + run.removed));
					shared = false;
					for (let i = at; i < at + run.inserted; i++) fresh.push(i);
				}
				for (let i = at; i < at + run.inserted; i++) asks.push(i);
				delta += run.inserted - run.removed;
			}
		}
		return { asks: [...new Set(asks)].sort((a, b) => a - b), fresh: new Set(fresh), gone };
	}

	follow();
	askAll(source.blocks(), slots);
	return {
		version() {
			settle();
			return version;
		},
		keys() {
			settle();
			shared = true;
			return slots;
		}
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Writes a watch may go unread past before it lets go. */
const LAPSE = 64;

/** G1.230 asks every block again, so a dev build checks only documents up to this size. */
const CHECKED_UP_TO = 2000;

// The check's own asks: uncounted, and a throw already reported answers ''.
const quietly = (depends: (block: Block) => string) => (block: Block) => {
	try {
		return String(depends(block));
	} catch {
		return '';
	}
};

/** Whether two lists of answers say the same things in the same order, '' left out. */
function sameSaying(a: readonly string[], b: readonly string[]): boolean {
	const said = (keys: readonly string[]) => keys.filter(Boolean);
	const [x, y] = [said(a), said(b)];
	return x.length === y.length && x.every((key, i) => key === y[i]);
}

/** The indices `at` still standing past one write's runs, moved by what each run put in. */
function shiftedPast(at: readonly number[], runs: readonly TopLevelChange[]): number[] {
	const out: number[] = [];
	for (const i of at) {
		let delta = 0;
		let gone = false;
		for (const run of runs) {
			if (i < run.at) break;
			if (i < run.at + run.removed) {
				gone = true;
				break;
			}
			delta += run.inserted - run.removed;
		}
		if (!gone) out.push(i + delta);
	}
	return out;
}
