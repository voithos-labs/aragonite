// @vitest-environment jsdom
// The caret landing on its own: resolve, mount, the tree-swap check, the placement, and the one
// scroll it may write. Headless blocks, with the scroll as a recording fake.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';
import { CURSOR_END, CURSOR_START, type BlockComponent } from '../../block-component';
import { createCaretMemory } from '../../caret/caret-memory';
import { docPathFrom } from '../../core/coordinate-spaces';
import type { ScrollOwner } from '../../windowing/scroll-owner';
import { refSlotsOver } from '../../block-lists/child-refs';
import { nodeAt } from '../../tree-operations/node-primitives';
import type { ChildList } from '../../block-lists/child-list';
import {
	createCaretLanding,
	type CaretLanding,
	type CaretLandingDeps,
	type LandOptions
} from '../../selection/caret-landing';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { stubBlockComponent } from '../../testing/headless-actions';
import { installEditorDomStubsForTests } from '#lib/testing.js';
import { stubScrollport } from '../harness/stub-scrollport';
import { takeDevWarns } from '../support/warn-gate';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

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
		caretWriter: testCaretWriter,
		caretMemory,
		// A stand-in element, so the scroll half has something to bring into view.
		getBlockElByPath: () => STAND_IN,
		getBlockBoxByPath: () => STAND_IN,
		getEditorRoot: () => null,
		scroll: null,
		isReading: () => false,
		...over
	};
	return {
		landing: createCaretLanding(deps),
		placements,
		caretMemory,
		doc,
		selectionState: deps.selectionState
	};
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
			caretWriter: testCaretWriter,
			getDoc: () => doc,
			root: mountingList(doc, [], placements, () => box.landing!.noteTreeSwap()),
			selectionState: createSelectionState({ getDoc: () => doc }),
			caretMemory: createCaretMemory(),
			getBlockElByPath: () => null,
			getBlockBoxByPath: () => null,
			getEditorRoot: () => null,
			scroll: null,
			isReading: () => false
		});
		expect(await box.landing.land(at([1], 0))).toBe('stale');
		expect(placements).toEqual([]);
	});

	// A merge or an arrow lands on text and follows the character before the caret; only a split's
	// second half starts fresh.
	it('a fresh landing means the outside of a hidden edge; an end, a start or a byte does not', async () => {
		const { landing, caretMemory } = landingOver('**a**\n\nb\n');
		await landing.land(at([0], CURSOR_END));
		expect(caretMemory.side()).toBeNull();
		await landing.land(at([1], CURSOR_START));
		expect(caretMemory.side()).toBeNull();
		await landing.land({ ...at([1], CURSOR_START), fresh: true });
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
			caretWriter: testCaretWriter,
			getDoc: () => doc,
			root: {
				count: () => 1,
				refs: refSlotsOver([scrolling]),
				windowing: { revealChild: async () => {}, isInWindow: () => true }
			},
			selectionState: createSelectionState({ getDoc: () => doc }),
			caretMemory: createCaretMemory(),
			getBlockElByPath: () => STAND_IN,
			getBlockBoxByPath: () => STAND_IN,
			getEditorRoot: () => null,
			scroll: { ...scroll, port: () => port },
			isReading: () => false
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
		caretMemory.noteOutside();
		const stamp = landing.generation();
		landing.noteTreeSwap();
		const point = { path: [1], offset: 0 };
		expect(await landing.restore({ anchor: point, focus: point }, { stamp })).toBe('unplaced');
		expect(caretMemory.side()).toBe('outside');
	});

	// Miss-analysis: the stale-restore row held a text caret only, so the gap branch, which places
	// its caret after the mount with no generation check, never met a tree that went away.
	it('a gap caret restore places nothing once the tree went away while it mounted', async () => {
		const doc = parse('a\n\nb\n');
		const selectionState = createSelectionState({ getDoc: () => doc });
		const box: { landing?: CaretLanding } = {};
		box.landing = createCaretLanding({
			// No native selection to clear in this suite's environment.
			caretWriter: { ...testCaretWriter, clear: () => {} },
			getDoc: () => doc,
			root: mountingList(doc, [], [], () => box.landing!.noteTreeSwap()),
			selectionState,
			caretMemory: createCaretMemory(),
			getBlockElByPath: () => null,
			getBlockBoxByPath: () => null,
			getEditorRoot: () => null,
			scroll: null,
			isReading: () => false
		});

		expect(await box.landing.restore({ gapCaret: { parentPath: [], index: 1 } })).toBe('unplaced');
		expect(selectionState.gapCaret).toBeNull();
	});

	// Parking moves focus to the end's block, and a rule's own keys would then win over the range's.
	it('showing a range end mounts it and shows it, the caret left where the range began', async () => {
		installEditorDomStubsForTests();
		const { scroll, calls } = recordingScroll(false);
		const { landing, placements, selectionState } = landingOver('a\n\nbc\n\n---\n', {
			scroll,
			// A real element, since the end is measured at its raw offset inside the block.
			getBlockElByPath: () => document.createElement('div')
		});
		for (const focus of [
			{ path: [1], offset: 2 },
			{ path: [2], offset: 3 }
		]) {
			selectionState.enterCrossBlock({ path: [0], offset: 1 }, focus);
			await landing.showSelectionEnd();
		}
		expect(placements).toEqual([]);
		expect(selectionState.isCrossBlock).toBe(true);
		expect(calls).toEqual(['showRect', 'showRect']);
	});

	// Miss-analysis: GH #111; the suite pinned the text branch's offset, never the cell branch's.
	// Miss-analysis: an end only mounted left IME nothing to compose in once the start block windowed out.
	it.each([
		{
			end: 'a text end',
			focus: { path: [1], offset: 2 },
			parked: [{ path: [1], offset: 2, parked: true }]
		},
		{
			end: 'a cell end',
			focus: { path: [2], offset: 0 },
			parked: [{ path: [2, 0, 0], offset: CURSOR_START, parked: true }]
		},
		{ end: 'a rule end', focus: { path: [3], offset: 0 }, parked: [] }
	])(
		'once the caret has left the editor, $end parks the caret, a block with no text excepted',
		async ({ focus, parked }) => {
			const source = 'a\n\nbc\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---\n';
			const held = landingOver(source, { getEditorRoot: () => document.body });
			held.selectionState.enterCrossBlock({ path: [0], offset: 1 }, focus);
			await held.landing.showSelectionEnd();
			expect(held.placements.filter((p) => p.parked)).toEqual([]);

			const lost = landingOver(source, { getEditorRoot: () => document.createElement('div') });
			lost.selectionState.enterCrossBlock({ path: [0], offset: 1 }, focus);
			await lost.landing.showSelectionEnd();
			expect(lost.placements.filter((p) => p.parked)).toEqual(parked);
		}
	);

	it('mount hands back the component without placing a caret', async () => {
		const { landing, placements } = landingOver('- a\n');
		expect(await landing.mount([0, 0])).not.toBeNull();
		expect(placements).toEqual([]);
	});
});

describe('a landing in reading mode', () => {
	/** A mounted paragraph `See [^a] here.` whose focus puts a caret down, as a block's does. */
	function readingBlock(clear?: () => void) {
		const el = document.createElement('div');
		el.tabIndex = 0;
		el.innerHTML =
			'See <span data-inline-widget data-source-start="4" data-source-end="8"><sup tabindex="0">1</sup></span> here.';
		document.body.replaceChildren(el);
		const doc = parse('See [^a] here.\n');
		const block = stubBlockComponent({
			focus: () => {
				el.focus();
				getSelection()!.collapse(el.lastChild!, 1);
			}
		});
		const landing = createCaretLanding({
			caretWriter: clear ? { ...testCaretWriter, clear } : testCaretWriter,
			getDoc: () => doc,
			root: {
				count: () => 1,
				refs: refSlotsOver([block]),
				windowing: { revealChild: async () => {}, isInWindow: () => true }
			},
			selectionState: createSelectionState({ getDoc: () => doc }),
			caretMemory: createCaretMemory(),
			getBlockElByPath: () => el,
			getBlockBoxByPath: () => el,
			getEditorRoot: () => document.body,
			scroll: null,
			isReading: () => true
		});
		return { landing, el, sup: el.querySelector('sup')! };
	}

	// Miss-analysis: every landing test ran outside reading mode, so a caret left behind there,
	// which Firefox starts Tab from, had nothing to fail.
	it('focuses the widget ending at the landing point, else the block, and leaves no caret', async () => {
		const { landing, el, sup } = readingBlock();
		expect(await landing.navigate(at([0], 8))).toEqual([0]);
		expect(document.activeElement).toBe(sup);
		expect(getSelection()!.rangeCount).toBe(0);

		await landing.navigate(at([0], 4));
		expect(document.activeElement).toBe(el);
		expect(getSelection()!.rangeCount).toBe(0);
	});

	it('a caret still there after the landing fails the reading-landing check', async () => {
		const { landing } = readingBlock(() => {});
		await landing.navigate(at([0], 0));
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:reading-landing-leaves-no-caret']);
	});

	// Miss-analysis: the check read the whole editor, so a click elsewhere during the jump's
	// scroll failed a landing that left nothing behind, and no test placed a caret outside the leaf.
	it('a caret a click put in another block during the scroll passes the check', async () => {
		const other = document.createElement('p');
		other.textContent = 'Elsewhere.';
		const { landing } = readingBlock(() => {
			document.body.append(other);
			getSelection()!.collapse(other.firstChild!, 2);
		});
		await landing.navigate(at([0], 0));
		expect(takeDevWarns()).toEqual([]);
	});
});
