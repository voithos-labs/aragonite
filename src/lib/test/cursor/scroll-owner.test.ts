// @vitest-environment jsdom
// Miss-analysis: who owns the scroll position was four predicates in four files, each tested on
// its own, so no test asked every writer the same three questions and a new writer answered none.
//
// Every scroll write the owner performs, asked under each owner of the position. The expected
// values are what each route did before it went through the owner.
import { describe, it, expect, vi } from 'vitest';
import { stubScrollOwner, stubScrollport } from '../harness/stub-scrollport';
import type { ScrollOwner } from '../../cursor/scroll-owner';
import type { Scrollport } from '../../cursor/scrollport';

const COLUMNS = ['host anchoring holds', 'a held placement is live', 'free'] as const;
type Column = (typeof COLUMNS)[number];

const START = 100;
const DELTA = 30;
// Where the root list's height table puts the held block, [4].
const TARGET_TOP = 300;

interface Fixture {
	owner: ScrollOwner;
	port: Scrollport;
	synced: ReturnType<typeof vi.fn>;
	/** What each mounted block's `scrollIntoView` was asked, by path. */
	scrolled: string[];
}

function fixture(column: Column, opts: { scrollTop?: number } = {}): Fixture {
	const port = stubScrollport({ viewportHeight: 500 });
	port.setScrollTop(opts.scrollTop ?? START);
	const scrolled: string[] = [];
	const el = (path: readonly number[]) => {
		const block = document.createElement('div');
		block.scrollIntoView = (o) => scrolled.push(`${JSON.stringify(path)} ${JSON.stringify(o)}`);
		return block;
	};
	const owner = stubScrollOwner(port, {
		editorCorrects: () => column !== 'host anchoring holds',
		getBlockElByPath: (path) => el(path)
	});
	const synced = vi.fn();
	owner.resolveTargetsWith({
		resolve: (path) => (path[0] === 4 ? { top: TARGET_TOP, height: 20 } : null),
		syncScrollTop: synced
	});
	if (column === 'a held placement is live') owner.place([4], { block: 'nearest', hold: true });
	return { owner, port, synced, scrolled };
}

interface Row {
	name: string;
	run(f: Fixture): Promise<void> | void;
	expect: Record<Column, (f: Fixture) => void>;
}

const heldBy = (delta: number) => (run: () => void) => {
	run();
	return delta;
};

const scrollTopIs = (top: number) => (f: Fixture) => expect(f.port.scrollTop()).toBe(top);
const replaced = (f: Fixture) => {
	expect(f.port.scrollTop()).toBe(TARGET_TOP);
	expect(f.synced).toHaveBeenCalledOnce();
};

// ── The table ────────────────────────────────────────────────────────────────

const ROWS: Record<keyof ScrollWrites, Row[]> = {
	compensate: [
		{
			name: 'a root list correction',
			run: (f) => f.owner.compensate('root-list', () => {}, heldBy(DELTA)),
			expect: {
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': replaced,
				free: scrollTopIs(START + DELTA)
			}
		},
		{
			name: 'a nested list correction',
			run: (f) => f.owner.compensate('nested-list', () => {}, heldBy(DELTA)),
			expect: {
				'host anchoring holds': scrollTopIs(START),
				// The root list re-places once the nested list's new height reaches it.
				'a held placement is live': scrollTopIs(START + DELTA),
				free: scrollTopIs(START + DELTA)
			}
		},
		{
			name: 'a subtotal reported up to the root list',
			run: (f) => f.owner.compensate('root-list', () => {}, heldBy(0)),
			expect: {
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': replaced,
				free: scrollTopIs(START)
			}
		},
		{
			name: 'the header slot, with the held block off its target',
			run: (f) => f.owner.compensate('header', () => {}, heldBy(DELTA)),
			expect: {
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': scrollTopIs(START + DELTA),
				free: scrollTopIs(START + DELTA)
			}
		}
	],
	place: [
		{
			name: 'a scroll into view of a mounted block',
			run: async (f) => {
				await f.owner.place([4], { block: 'nearest', hold: true }).scroll();
			},
			expect: {
				'host anchoring holds': placedOn4,
				// The newer placement takes the slot and writes.
				'a held placement is live': placedOn4,
				free: placedOn4
			}
		}
	],
	scrollToMount: [
		{
			name: 'a descent mounting a block',
			run: (f) => f.owner.scrollToMount(250),
			expect: {
				'host anchoring holds': scrollTopIs(250),
				'a held placement is live': (f) => {
					scrollTopIs(250)(f);
					expect(f.owner.heldTarget()?.path).toEqual([4]);
				},
				free: scrollTopIs(250)
			}
		}
	],
	keep: [
		{
			name: 'a view swap clamped by the browser',
			run: async (f) => {
				const restore = f.owner.keep();
				f.port.setScrollTop(40);
				await restore();
			},
			expect: {
				// Native anchoring can't undo a max-scroll clamp.
				'host anchoring holds': scrollTopIs(START),
				'a held placement is live': scrollTopIs(40),
				free: scrollTopIs(START)
			}
		}
	],
	showNearest: [
		{
			name: 'a keyboard extension reaching the next block',
			run: (f) => f.owner.showNearest([2]),
			expect: {
				'host anchoring holds': nearestOn2,
				'a held placement is live': (f) => {
					nearestOn2(f);
					// Claims nothing: the held target stays as it was.
					expect(f.owner.heldTarget()?.path).toEqual([4]);
				},
				free: nearestOn2
			}
		}
	]
};

function placedOn4(f: Fixture): void {
	expect(f.scrolled).toEqual(['[4] {"block":"nearest"}']);
	expect(f.owner.heldTarget()).toEqual({ path: [4], block: 'nearest' });
}

function nearestOn2(f: Fixture): void {
	expect(f.scrolled).toEqual(['[2] {"block":"nearest","inline":"nearest"}']);
	expect(f.port.scrollTop()).toBe(START);
}

// ── The census ───────────────────────────────────────────────────────────────

/** The owner's members that write no scroll position. */
const NON_WRITES = ['port', 'isInView', 'heldTarget', 'release', 'resolveTargetsWith'] as const;
type ScrollWrites = Omit<ScrollOwner, (typeof NON_WRITES)[number]>;

describe('scroll owner: every write has a row under every owner of the position', () => {
	it('each member is a write with rows or a declared read', () => {
		const members = Object.keys(fixture('free').owner).sort();
		expect(members).toEqual([...Object.keys(ROWS), ...NON_WRITES].sort());
		for (const rows of Object.values(ROWS)) expect(rows.length).toBeGreaterThan(0);
	});

	for (const [write, rows] of Object.entries(ROWS)) {
		for (const row of rows) {
			for (const column of COLUMNS) {
				it(`${write}: ${row.name} / ${column}`, async () => {
					const f = fixture(column);
					await row.run(f);
					row.expect[column](f);
				});
			}
		}
	}
});

// ── The edges a column hides ─────────────────────────────────────────────────

describe('scroll owner: the edges', () => {
	it('host anchoring wins over a held placement for a correction', () => {
		const f = fixture('host anchoring holds');
		f.owner.place([4], { block: 'nearest', hold: true });
		let ran = false;
		f.owner.compensate('root-list', () => (ran = true), heldBy(DELTA));
		expect(ran).toBe(true);
		expect(f.port.scrollTop()).toBe(START);
	});

	it('the header slot stands down while the held block already sits on its target', () => {
		const f = fixture('a held placement is live', { scrollTop: TARGET_TOP + 1 });
		f.owner.compensate('header', () => {}, heldBy(DELTA));
		expect(f.port.scrollTop()).toBe(TARGET_TOP + 1);
	});

	it('a held target the root list cannot place falls through to the held block', () => {
		const f = fixture('free');
		f.owner.place([9], { block: 'nearest', hold: true });
		f.owner.compensate('root-list', () => {}, heldBy(DELTA));
		expect(f.port.scrollTop()).toBe(START + DELTA);
	});

	it('a centred held target re-places on its own height', () => {
		const f = fixture('free');
		f.owner.place([4], { block: 'center', hold: true });
		f.owner.compensate('root-list', () => {}, heldBy(DELTA));
		expect(f.port.scrollTop()).toBe(TARGET_TOP - (500 - 20) / 2);
	});

	it('keep writes nothing when the swap moved nothing', async () => {
		const f = fixture('free');
		const write = vi.spyOn(f.port, 'setScrollTop');
		await f.owner.keep()();
		expect(write).not.toHaveBeenCalled();
	});

	it('before the root mounts there is no port, and every write is inert', async () => {
		const owner = stubScrollOwner(stubScrollport({ viewportHeight: 500 }), {
			getScrollHost: () => null
		});
		expect(owner.port()).toBeNull();
		await expect(owner.keep()()).resolves.toBeUndefined();
		let ran = false;
		owner.compensate('root-list', () => (ran = true), heldBy(DELTA));
		expect(ran).toBe(true);
	});
});
