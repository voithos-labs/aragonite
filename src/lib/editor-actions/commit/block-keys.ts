/**
 * The answers a surface that reads the rest of the document redraws on: what its `depends(block)`
 * says of each top-level block (a toc, the headings in it; footnote numbering, the references).
 * A watch asks every block once as it starts, then only the blocks a write's runs replaced, and
 * asks them after the write, when the answers are read: a position read inside a write fails a
 * dev build. The answers change when one that says something (not '') leaves its index, so an
 * Enter in prose below the last such answer changes nothing.
 */
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import type { Block, KeyWatch } from '../../schema/doc-view';
import type { TopLevelChange } from '../../tree-operations/top-level-starts';
import { checkKeptKeys } from '../../invariants/kept-keys';
import { perfEnabled, recordKeyAsked, recordKeyWriteHeard } from '../../perf/instruments';
import type { WriteFollower } from './kept-starts';

/** The writes a watch follows and the blocks it asks, read by index. */
export interface KeySource {
	follow(follower: WriteFollower): () => void;
	count(): number;
	block(i: number): Block;
}

/** Starts asking now; a throw in `depends` reaches `report` and answers '', as a nullish answer
 *  does. */
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
			return String(depends(block) ?? '');
		} catch (cause) {
			report(cause);
			return '';
		}
	};

	function follow(): void {
		writes = [];
		unfollow = source.follow({
			heard({ runs }) {
				recordKeyWriteHeard();
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
		// A reader that comes back hears of what went, whatever the blocks say by then.
		if (!sameFrom(slots, [], 0)) version++;
		slots = [];
	}

	function askAll(was: readonly string[]): void {
		slots = Array.from({ length: source.count() }, (_, i) => ask(source.block(i)));
		shared = false;
		if (!sameFrom(was, slots, 0)) version++;
	}

	function settle(): void {
		if (!writes) {
			follow();
			askAll(slots);
			return;
		}
		if (writes.length === 0) return;
		const done = writes;
		writes = [];
		const was = slots;
		const moves = done.includes(null) ? null : replaced(done as (readonly TopLevelChange[])[]);
		// A write that couldn't say, or runs that don't add up, ask every block.
		if (!moves || slots.length !== source.count()) askAll(was);
		else {
			const resized = slots !== was;
			let changed = false;
			for (const i of moves.asks) {
				const key = ask(source.block(i));
				if (key === slots[i]) continue;
				if (shared) slots = slots.slice();
				shared = false;
				slots[i] = key;
				changed = true;
			}
			// Blocks put in or taken out move every answer after them.
			if (resized ? !sameFrom(was, slots, moves.from) : changed) version++;
		}
		if (devChecksOn && !perfEnabled() && slots.length <= CHECKED_UP_TO) {
			const fresh = () =>
				Array.from({ length: source.count() }, (_, i) => quietly(depends, source.block(i)));
			assertInvariant('kept-keys', () => checkKeptKeys(slots, fresh()));
		}
	}

	/** Moves the slots past each write's runs, '' where a block is new, and names the slots to
	 *  ask and the first index any run reached. */
	function replaced(done: readonly (readonly TopLevelChange[])[]) {
		let asks: number[] = [];
		let from = slots.length;
		for (const runs of done) {
			asks = shiftedPast(asks, runs);
			if (runs.length) from = Math.min(from, runs[0].at);
			let delta = 0;
			for (const run of runs) {
				const at = run.at + delta;
				if (run.removed !== run.inserted) {
					const made = new Array<string>(run.inserted).fill('');
					// Joined, never spliced in: a run can put in a document's worth of blocks.
					slots = slots.slice(0, at).concat(made, slots.slice(at + run.removed));
					shared = false;
				}
				for (let i = at; i < at + run.inserted; i++) asks.push(i);
				delta += run.inserted - run.removed;
			}
		}
		return { asks: [...new Set(asks)].sort((a, b) => a - b), from };
	}

	follow();
	askAll(slots);
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
function quietly(depends: (block: Block) => string, block: Block): string {
	try {
		return String(depends(block) ?? '');
	} catch {
		return '';
	}
}

/** Whether two lists of answers say the same at every index from `from` on, '' and no slot alike. */
function sameFrom(a: readonly string[], b: readonly string[], from: number): boolean {
	for (let i = from, end = Math.max(a.length, b.length); i < end; i++) {
		if ((a[i] ?? '') !== (b[i] ?? '')) return false;
	}
	return true;
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
