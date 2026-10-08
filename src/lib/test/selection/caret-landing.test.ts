// The caret landing on its own: resolve, mount, the tree-swap check, the placement, and the one
// scroll it may write. Headless blocks, with the scroll as a recording fake.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';
import { CURSOR_END, CURSOR_START, type BlockComponent } from '../../block-component';
import { createCaretMemory } from '../../caret/caret-memory';
import { docPathFrom } from '../../caret/coordinate-spaces';
import type { ScrollOwner } from '../../windowing/scroll-owner';
import { refSlotsOver } from '../../reactivity/publish-ref.svelte';
import { nodeAt } from '../../tree-operations/node-primitives';
import type { ChildList } from '../../reactivity/child-list';
import {
	createCaretLanding,
	type CaretLanding,
	type CaretLandingDeps,
	type LandOptions
} from '../../selection/caret-landing';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { stubBlockComponent } from '../../testing/headless-actions';
import { stubScrollport } from '../harness/stub-scrollport';
import { takeDevWarns } from '../support/warn-gate';

interface Placement {
	path: number[];
	offset: number;
	parked?: true;
}

/** A child list over `doc`'s children whose blocks mount only when revealed, one microtask later,
 *  and whose containers answer with a list over their own children. */
function mountingList(
	doc: Document,
	path: number[],
	placements: Placement[],
	onReveal: () => void = () => {}
): ChildList {
	const node = nodeAt(doc, path)!;
	const refs: (BlockComponent | undefined)[] = [];
	return {
		count: () => node.children?.length ?? 0,
		refs: refSlotsOver(refs),
		windowing: {
			async revealChild(index) {
				onReveal();
				await Promise.resolve();
				const at = [...path, index];
				refs[index] = stubBlockComponent({
					focus: (offset) => placements.push({ path: at, offset }),
					parkCaret: (offset) => placements.push({ path: at, offset, parked: true }),
					childList: () => mountingList(doc, at, placements)
				});
			},
			isInWindow: (index) => refs[index] !== undefined
		}
	};
}

function recordingScroll(visible: boolean) {
	const calls: string[] = [];
	const scroll: Pick<ScrollOwner, 'shows' | 'showRect' | 'place' | 'port'> = {
		port: () => null,
		shows: () => visible,
		// Records a write only when the landing's read asks for one.
		showRect: (read) => {
			if (read()) calls.push('showRect');
		},
		place: (_path, { hold }) => {
			calls.push(hold ? 'place, held' : 'place');
			return {
				scroll: async () => {
					calls.push('scroll');
					return true;
				}
			};
		}
	};
	return { scroll, calls };
}

/** A block element with a box and no caret inside it; the recording scroll decides what shows. */
const STAND_IN = {
	getBoundingClientRect: () => ({ top: 0, bottom: 20 }),
	contains: () => false
} as unknown as HTMLElement;

function landingOver(source: string, over: Partial<CaretLandingDeps> = {}) {
	const doc = parse(source);
	const placements: Placement[] = [];
	const caretMemory = createCaretMemory();
	const deps: CaretLandingDeps = {
		getDoc: () => doc,
		root: mountingList(doc, [], placements),
		selectionState: createSelectionState({ getDoc: () => doc }),
		caretMemory,
		// A stand-in element, so the scroll half has something to bring into view.
		getBlockElByPath: () => STAND_IN,
		getEditorRoot: () => null,
		scroll: null,
		...over
	};
	return { landing: createCaretLanding(deps), placements, caretMemory, doc };
}

const at = (path: number[], offset: number) => ({ path: docPathFrom(path), offset });

describe('landing a caret', () => {
	it('mounts a block that is not mounted yet, then focuses it', async () => {
		const { landing, placements } = landingOver('a\n\nb\n\nc\n');
		expect(await landing.land(at([2], 1))).toBe('placed');
		expect(placements).toEqual([{ path: [2], offset: 1 }]);
	});

	it('descends a container position to the leaf a caret can sit in, mounting each level', async () => {
		const { landing, placements } = landingOver('- a\n- b\n');
		await landing.land(at([0, 1], 0));
		expect(placements).toEqual([{ path: [0, 1, 0], offset: 0 }]);
	});

	it('places nothing for a path the tree no longer has', async () => {
		const { landing, placements } = landingOver('a\n');
		expect(await landing.land(at([4], 0))).toBe('unresolvable');
		expect(placements).toEqual([]);
	});

	// Miss-analysis: the stamp lived only in the paste landing, so no test swapped the tree under
	// any other landing while it waited for a mount.
	it('places nothing when an undo, redo or document swap happened while it mounted', async () => {
		const doc = parse('a\n\nb\n');
		const placements: Placement[] = [];
		const box: { landing?: ReturnType<typeof createCaretLanding> } = {};
		box.landing = createCaretLanding({
			getDoc: () => doc,
			root: mountingList(doc, [], placements, () => box.landing!.noteTreeSwap()),
			selectionState: createSelectionState({ getDoc: () => doc }),
			caretMemory: createCaretMemory(),
			getBlockElByPath: () => null,
			getEditorRoot: () => null,
			scroll: null
		});
		expect(await box.landing.land(at([1], 0))).toBe('stale');
		expect(placements).toEqual([]);
	});

	it('an end or start landing means the outside of a hidden closer; a byte offset does not', async () => {
		const { landing, caretMemory } = landingOver('**a**\n\nb\n');
		await landing.land(at([0], CURSOR_END));
		expect(caretMemory.side()).toBe('outside');
		await landing.land(at([1], CURSOR_START));
		expect(caretMemory.side()).toBe('outside');
		await landing.land(at([0], 2));
		expect(caretMemory.side()).toBeNull();
	});
});

describe('bringing a landing into view', () => {
	it('shows an off-screen caret the least distance, holding nothing', async () => {
		const { scroll, calls } = recordingScroll(false);
		const { landing } = landingOver('a\n', { scroll });
		await landing.land(at([0], 0));
		expect(calls).toEqual(['showRect']);
	});

	it('writes no scroll for a block already in view', async () => {
		const { scroll, calls } = recordingScroll(true);
		const { landing } = landingOver('a\n', { scroll });
		await landing.land(at([0], 0));
		expect(calls).toEqual([]);
	});

	it("only mounts under 'mount'", async () => {
		const { scroll, calls } = recordingScroll(false);
		const { landing, placements } = landingOver('a\n', { scroll });
		await landing.land(at([0], 0), { reveal: 'mount' });
		expect(calls).toEqual([]);
		expect(placements).toHaveLength(1);
	});

	// Miss-analysis: any landing could ask to be held, and the menus and the link card did, which
	// is how a slash pick came to drag its line to the top of the page.
	it('only a navigation can hold: no landing option asks for it', () => {
		const tryToHold = (landing: CaretLanding) => {
			const held: LandOptions = {
				// @ts-expect-error a held landing is `navigate`'s alone; widening `RevealPolicy` fails check.
				reveal: 'into-view-held'
			};
			void landing.land(at([0], 0), held);
		};
		expect(tryToHold).toBeTypeOf('function');
	});

	it('a navigation holds its block, even one already in view', async () => {
		const { scroll, calls } = recordingScroll(true);
		const { landing } = landingOver('a\n', { scroll });
		await landing.navigate(at([0], 0));
		expect(calls).toEqual(['place, held', 'scroll']);
	});

	// Miss-analysis: the landing's focus call scrolled natively, and no test watched the scroll
	// position across it, so a second writer sat beside the reveal policy unseen.
	it('a focus call that scrolls fails the landing-focus check', async () => {
		const port = stubScrollport({ viewportHeight: 500 });
		const { scroll } = recordingScroll(true);
		const doc = parse('a\n');
		const scrolling = stubBlockComponent({ focus: () => port.setScrollTop(120) });
		const landing = createCaretLanding({
			getDoc: () => doc,
			root: {
				count: () => 1,
				refs: refSlotsOver([scrolling]),
				windowing: { revealChild: async () => {}, isInWindow: () => true }
			},
			selectionState: createSelectionState({ getDoc: () => doc }),
			caretMemory: createCaretMemory(),
			getBlockElByPath: () => STAND_IN,
			getEditorRoot: () => null,
			scroll: { ...scroll, port: () => port }
		});
		await landing.land(at([0], 0));
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landing-focus-scrolls-nothing']);
	});
});

describe('the other entry points', () => {
	it('park mounts and parks without focusing', async () => {
		const { landing, placements } = landingOver('a\n\nbc\n');
		expect(await landing.park(at([1], 2))).toBe(true);
		expect(placements).toEqual([{ path: [1], offset: 2, parked: true }]);
	});

	it('a stale restore places nothing and keeps how the caret arrived', async () => {
		const { landing, caretMemory } = landingOver('a\n\nb\n');
		caretMemory.noteExtreme();
		const stamp = landing.generation();
		landing.noteTreeSwap();
		const point = { path: [1], offset: 0 };
		expect(await landing.restore({ anchor: point, focus: point }, { stamp })).toBe('unplaced');
		expect(caretMemory.side()).toBe('outside');
	});

	it('mount hands back the component without placing a caret', async () => {
		const { landing, placements } = landingOver('- a\n');
		expect(await landing.mount([0, 0])).not.toBeNull();
		expect(placements).toEqual([]);
	});
});
