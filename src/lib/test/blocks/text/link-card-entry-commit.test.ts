// @vitest-environment jsdom
// The link card without mounting it: committing a url edit, and entering create or edit
// mode from a caret or a range.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createInlineRangeCommit } from '$lib/editor-actions/inline-range-commit';
import { createLinkCardCommitter } from '$lib/components/link-card/link-card-commit';
import { type LinkTarget } from '$lib/components/blocks/text/link-at-point';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { fixtureReading } from '../../harness/fixture-grammar';
import { settleEditor } from '$lib/test/harness/settle';
import { type NodeView } from '$lib/core/node-views';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { enterLinkCardAtCaret } from '$lib/components/link-card/link-card-entry';
import { type CstNode } from '$lib/core/nodes';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { makeRenderHarness } from '$lib/test/harness/text-render';
import { type Reading } from '$lib/schema/reading';

describe('commit', () => {
	// What the card decides on top of the byte writer: which fields survive a URL edit, and when the
	// reference form is kept. The bytes themselves are the writer's business.

	function makeCard(source: string) {
		const harness = makeEditorActionsDeps(parse(source).children);
		const map = buildLinkReferenceMap(harness.doc.children);
		const controller = createUndoController(harness.deps);
		const committer = createLinkCardCommitter({
			getDoc: () => harness.doc,
			getEditorEl: () => null,
			getTarget: () => null,
			getCreateTarget: () => null,
			inlineRange: createInlineRangeCommit({ deps: harness.deps, controller }),
			events: harness.events,
			measureRange: () => [],
			reading: fixtureReading({ resolver: map.resolve, resolverSignature: map.signature })
		});
		const raw = () => harness.doc.children[0].raw;
		return {
			committer,
			raw,
			landings: harness.landings,
			target: { path: [0], sourceStart: raw().indexOf('[') } as LinkTarget
		};
	}

	describe('link card commit: which fields survive a url edit', () => {
		it('keeps a title the card never showed', async () => {
			const card = makeCard('Visit [x](old "Ti") now\n');
			card.committer.commitUrl(card.target, 'new');
			await settleEditor();
			expect(card.raw()).toBe('Visit [x](new "Ti") now\n');
		});

		it('keeps the link text bytes, nested constructs and all', async () => {
			const card = makeCard('Visit [**b** c](old) now\n');
			card.committer.commitUrl(card.target, 'new');
			await settleEditor();
			expect(card.raw()).toBe('Visit [**b** c](new) now\n');
		});

		it('an unchanged url writes nothing at all', async () => {
			const card = makeCard('Visit [x](old) now\n');
			card.committer.commitUrl(card.target, 'old');
			await settleEditor();
			expect(card.raw()).toBe('Visit [x](old) now\n');
		});

		// Miss-analysis: the case above used a URL the serializer reproduces exactly, hiding the rewrite.
		it('an unchanged url never respells author bytes the serializer would normalize', async () => {
			const card = makeCard('Visit [x](<a b>) now\n');
			// What the field shows for the angle form, committed back untouched.
			expect(card.committer.resolve(card.target)?.url).toBe('a%20b');
			card.committer.commitUrl(card.target, 'a%20b');
			await settleEditor();
			expect(card.raw()).toBe('Visit [x](<a b>) now\n');
		});
	});

	describe('link card commit: the create half', () => {
		it('creates the wrap over the range and lands the caret at the construct start', async () => {
			const card = makeCard('Alpha bravo charlie\n');
			card.committer.commitCreate({ path: [0], start: 6, end: 11 }, 'https://n.test/x');
			await settleEditor();
			await settleEditor();
			expect(card.raw()).toBe('Alpha [bravo](https://n.test/x) charlie\n');
			expect(card.landings).toMatchObject([{ leafPath: [0], offset: 6 }]);
		});

		it('a range the join declines writes nothing', async () => {
			const card = makeCard('Visit [x](old) now\n');
			card.committer.commitCreate({ path: [0], start: 2, end: 9 }, 'https://n.test/x');
			await settleEditor();
			expect(card.raw()).toBe('Visit [x](old) now\n');
			expect(card.landings).toEqual([]);
		});
	});

	describe('link card commit: reference forms', () => {
		const DOC = 'Read [docs][ref] later\n\n[ref]: https://example.com/d\n';

		it('resolves the destination the definition supplies', () => {
			const card = makeCard(DOC);
			expect(card.committer.resolve(card.target)?.url).toBe('https://example.com/d');
		});

		it('a new url inlines the form and leaves the definition alone', async () => {
			const card = makeCard(DOC);
			card.committer.commitUrl(card.target, 'https://example.com/new');
			await settleEditor();
			expect(card.raw()).toBe('Read [docs](https://example.com/new) later\n');
		});

		it('remove-link unwraps to the text, definition untouched', async () => {
			const card = makeCard(DOC);
			card.committer.removeLink(card.target);
			await settleEditor();
			expect(card.raw()).toBe('Read docs later\n');
		});
	});
});

describe('create entry', () => {
	// How create mode opens and refuses: the state's own `canOpenCreate` check, and the entry's own
	// check of the range before it. The chord is the only entry allowed to create.

	function makeState(allowCreate: () => boolean = () => true) {
		const onOpen = vi.fn();
		const card = createLinkCardState({
			onOpen,
			canOpen: () => true,
			canEnter: () => true,
			canOpenCreate: allowCreate
		});
		return { card, onOpen };
	}

	describe('the create entry point', () => {
		it('declines when canOpenCreate says no, placing nothing', () => {
			const { card, onOpen } = makeState(() => false);
			expect(card.enterCreate({ path: [0], start: 1, end: 3 })).toBe(false);
			expect(card.getCreateTarget()).toBeNull();
			expect(onOpen).not.toHaveBeenCalled();
		});

		it('puts the caret at the range, snapshots the caret and bumps the focus epoch', () => {
			const { card, onOpen } = makeState();
			expect(card.enterCreate({ path: [0], start: 6, end: 11 })).toBe(true);
			expect(card.getCreateTarget()).toEqual({ path: [0], start: 6, end: 11 });
			expect(onOpen).toHaveBeenCalledTimes(1);
			expect(card.getFocusEpoch()).toBeGreaterThan(0);
		});

		it('one card, one target: each entry kind clears the other, and close clears both', () => {
			const { card } = makeState();
			card.enterCreate({ path: [0], start: 6, end: 11 });
			card.enter({ path: [0], sourceStart: 6 });
			expect(card.getCreateTarget()).toBeNull();
			expect(card.getTarget()).not.toBeNull();
			card.enterCreate({ path: [0], start: 6, end: 11 });
			expect(card.getTarget()).toBeNull();
			expect(card.getCreateTarget()).not.toBeNull();
			card.close();
			expect(card.getCreateTarget()).toBeNull();
		});
	});

	describe('the chord entry vets the range before the entry point', () => {
		function enter(
			card: ReturnType<typeof makeState>['card'],
			source: string,
			selection: { start: number; end: number } | null,
			mode: 'live' | 'source' = 'live',
			crossBlockRange = false
		): void {
			enterLinkCardAtCaret({
				contentEl: document.createElement('div'),
				block: parse(source).children[0] as NodeView,
				path: [0],
				card,
				selection,
				crossBlockRange,
				reading: fixtureReading({}, mode)
			});
		}

		it('a plain-text selection enters create mode on the range', () => {
			const { card } = makeState();
			enter(card, 'Alpha bravo charlie\n', { start: 6, end: 11 });
			expect(card.getCreateTarget()).toEqual({ path: [0], start: 6, end: 11 });
		});

		it('a selection crossing a link declines: neither card mode opens', () => {
			const { card } = makeState();
			enter(card, 'Visit [example](https://e.c) now\n', { start: 2, end: 9 });
			expect(card.getCreateTarget()).toBeNull();
			expect(card.getTarget()).toBeNull();
		});

		it('outside live mode the chord enters nothing', () => {
			const { card } = makeState();
			enter(card, 'Alpha bravo charlie\n', { start: 6, end: 11 }, 'source');
			expect(card.getCreateTarget()).toBeNull();
		});

		it('a degenerate range is not a create gesture', () => {
			const { card } = makeState();
			enter(card, 'Alpha bravo charlie\n', { start: 6, end: 6 });
			expect(card.getCreateTarget()).toBeNull();
		});

		// A cross-block drag reads as a range running to this block's end, one nobody selected.
		// Miss-analysis: every case supplied a range the caller had measured, never an untrusted one.
		it('a cross-block range enters nothing, whatever the block-local offsets say', () => {
			const { card, onOpen } = makeState();
			enter(card, 'Alpha bravo charlie\n', { start: 6, end: 19 }, 'live', true);
			expect(card.getCreateTarget()).toBeNull();
			expect(card.getTarget()).toBeNull();
			expect(onOpen).not.toHaveBeenCalled();
		});
	});
});

describe('range entry', () => {
	// A chord over a range inside one link edits that link, since create refuses those bytes.
	// Miss-analysis: create cases used ranges over plain text or across a construct, never inside one.

	/** `Visit [example](https://x.com) now`: the link spans [6, 30), ` now` runs to 34. */
	const LINKED = 'Visit [example](https://x.com) now\n';

	function mount(source: string): {
		el: HTMLElement;
		node: CstNode;
		reading: Reading;
	} {
		const node = parse(source).children[0];
		const harness = makeRenderHarness(node, { mode: 'live' });
		createTextRender(harness.deps).render();
		return { el: harness.el, node, reading: fixtureReading() };
	}

	/** A real DOM range over raw offsets: a prose block with no marker prefix maps one to one. */
	function seat(el: HTMLElement, start: number, end: number): void {
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(createRangeAtDomTextOffsets(el, asDomTextOffset(start), asDomTextOffset(end))!);
	}

	function makeCard(crossBlock = false) {
		return createLinkCardState({
			onOpen: () => {},
			canOpen: () => window.getSelection()?.isCollapsed !== false,
			canEnter: () => !crossBlock,
			canOpenCreate: () => true
		});
	}

	function press(
		source: string,
		start: number,
		end: number,
		crossBlockRange = false
	): ReturnType<typeof makeCard> {
		const { el, node, reading } = mount(source);
		seat(el, start, end);
		const card = makeCard(crossBlockRange);
		enterLinkCardAtCaret({
			contentEl: el,
			block: node,
			path: [0],
			reading: fixtureReading(reading, 'live'),
			card,
			selection: start === end ? null : { start, end },
			crossBlockRange
		});
		return card;
	}

	afterEach(() => {
		document.body.replaceChildren();
		window.getSelection()?.removeAllRanges();
	});

	describe('the chord over a range inside a link', () => {
		it('enters that link’s card, with the focus epoch the chord must supply', () => {
			const card = press(LINKED, 8, 12);
			expect(card.getTarget()).toEqual({ path: [0], sourceStart: 6 });
			expect(card.getCreateTarget()).toBeNull();
			expect(card.getFocusEpoch()).toBeGreaterThan(0);
		});

		it('takes the whole construct’s own bytes as inside it', () => {
			expect(press(LINKED, 6, 30).getTarget()).toEqual({ path: [0], sourceStart: 6 });
		});

		it('a range running out of the link keeps the create fork, which declines those bytes', () => {
			const card = press(LINKED, 2, 10);
			expect(card.getTarget()).toBeNull();
			expect(card.getCreateTarget()).toBeNull();
		});

		it('a range over plain text still creates', () => {
			expect(press(LINKED, 30, 34).getCreateTarget()).toEqual({ path: [0], start: 30, end: 34 });
		});

		it('a collapsed caret inside the link enters it, as it always did', () => {
			expect(press(LINKED, 10, 10).getTarget()).toEqual({ path: [0], sourceStart: 6 });
		});

		// The one check the entry cannot make for itself: block-local offsets are invented there.
		it('a cross-block range enters nothing, even with the offsets inside the link', () => {
			const card = press(LINKED, 8, 12, true);
			expect(card.getTarget()).toBeNull();
			expect(card.getCreateTarget()).toBeNull();
		});
	});
});
