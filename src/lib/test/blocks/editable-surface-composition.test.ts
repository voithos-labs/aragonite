// @vitest-environment jsdom
// The editable surface's composition window: the gate, the commit through real actions,
// and where a composed run is placed.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { takeDevWarns } from '../support/warn-gate';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, type EditorActionsHarness } from '../harness/editor-actions';
import { parseInline } from '$lib/core/inline';
import { createCompositionSeat } from '$lib/components/blocks/text/composition-seat';
import { replaceRangeInLeaf } from '$lib/tree-operations/leaf-range';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { type EdgeAffinity } from '$lib/cursor/edge-affinity';
import { createCaretMemory } from '$lib/cursor/caret-memory';
import { createTypedPlacement } from '$lib/components/blocks/text/edge-seat';
import { fixtureReading, topLevelStore } from '../harness/fixture-grammar';

describe('composing gate', () => {
	// Input inside the composition window never commits; the end commits once with the offsets captured at start.

	afterEach(() => {
		document.body.innerHTML = '';
	});

	describe('editable surface: the composing gate', () => {
		it('input events inside the window never commit; the end commits the DOM text once', () => {
			const { surface, commits, el } = makeSurface();
			el.textContent = 'hello';
			surface.onCompositionStart();

			el.textContent = 'helloか';
			surface.onInput();
			el.textContent = 'helloかん';
			surface.onInput();
			expect(commits).toHaveLength(0);

			surface.onCompositionEnd();
			expect(commits.map((c) => c.text)).toEqual(['helloかん']);
		});

		it('the offsets captured at start survive a caret the IME moved mid-window', () => {
			const { surface, commits, el, setCaret } = makeSurface();
			el.textContent = 'hello';
			setCaret(5);
			surface.onCompositionStart();

			// The IME advances the caret as it composes, and its beforeinput events are gated on the
			// composing flag, so 5 must survive.
			setCaret(7);
			surface.onBeforeInput(new InputEvent('beforeinput', { inputType: 'insertCompositionText' }));
			el.textContent = 'helloかん';
			surface.onCompositionEnd();

			expect(commits).toEqual([{ text: 'helloかん', preEdit: 5, saved: 7 }]);
		});

		it('input after the window closes commits normally again', () => {
			const { surface, commits, el } = makeSurface();
			el.textContent = 'hello';
			surface.onCompositionStart();
			surface.onCompositionEnd();

			el.textContent = 'hello!';
			surface.onInput();
			expect(commits.map((c) => c.text)).toEqual(['hello', 'hello!']);
		});
	});

	describe('editable surface: composition window (G1.27)', () => {
		it('compositionend with no open composition fires', () => {
			const { surface } = makeSurface();
			surface.onCompositionEnd();
			const fires = takeDevWarns();
			expect(fires.map((w) => w.tag)).toEqual(['invariant:composition-window']);
			expect(fires[0].details).toBe('end-without-start');
		});

		it('a paired start → end cycle stays silent', () => {
			const { surface } = makeSurface();
			surface.onCompositionStart();
			surface.onCompositionEnd();
			expect(takeDevWarns()).toEqual([]);
		});
	});
});

describe('commit', () => {
	// A composed commit lands once, one undo restores the caret from `compositionstart`, and a cancel changes nothing.

	const SOURCE = 'hello world\n';

	let harness: EditorActionsHarness;
	let surface: SurfaceHarness;

	beforeEach(() => {
		document.body.innerHTML = '';
		harness = makeEditorActionsDeps(parse(SOURCE).children);
		const controller = createUndoController(harness.deps);
		const blockEdit = createBlockEditActions(harness.deps, controller);
		surface = makeSurface({ blockEdit, getNode: () => harness.doc.children[0] });
		surface.el.textContent = 'hello world';
	});

	describe('composition commit through the real actions', () => {
		it('a composed commit lands once, anchored at the pre-composition offset', () => {
			surface.setCaret(11);
			surface.surface.onCompositionStart();
			surface.setCaret(13);
			surface.el.textContent = 'hello worldかん';
			surface.surface.onCompositionEnd();

			expect(serialize(harness.doc)).toBe('hello worldかん\n');

			// The whole composition is one debounced-batch snapshot: its selection is
			// the undo anchor, so one undo restores the pre-composition state.
			const undo = harness.deps.undoManager.getStacks().undo;
			expect(undo).toHaveLength(1);
			expect(rangeSelectionOf(undo[0]).anchor).toEqual({ path: [0], offset: 11 });
			expect(serialize(undo[0].snapshot)).toBe(SOURCE);
		});

		it('a cancelled composition leaves the document byte-identical', () => {
			surface.setCaret(11);
			surface.surface.onCompositionStart();
			surface.surface.onCompositionEnd();

			expect(serialize(harness.doc)).toBe(SOURCE);
		});
	});
});

describe('composed text placement', () => {
	// What a `compositionend` commit writes in each presentation mode, by the side the caret meant.
	// Miss-analysis: no composition test ran outside live mode, so only keydown checked the mode.

	beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
	afterEach(() => {
		__resetLiveJoinSeamCleanerForTests();
		document.body.innerHTML = '';
	});

	// `Some **bold** text`: strong [5,13), content [7,11), and 11 is the trailing run's near side.
	const BOLD = 'Some **bold** text';

	interface SeatHarness {
		surface: SurfaceHarness;
		compose: (domAfter: string, caretAt: number) => void;
		selectRange: (start: number, end: number) => void;
	}

	function makeSeatHarness(source: string, affinity: EdgeAffinity | null): SeatHarness {
		const node = parse(`${source}\n`, { scope: 'fragment' }).children[0];
		let rawSelection: { start: number; end: number } | null = null;
		const caretMemory = createCaretMemory();
		if (affinity === 'far') caretMemory.noteKey({ key: 'ArrowLeft' }, null);
		const getInlines = () => parseInline(source, 0, source.length);
		// The deps read `surface` lazily, so the const below is initialized before any of them run.
		const seat = createCompositionSeat({
			getDisplayText: () => surface.el.textContent ?? '',
			getInlines,
			reading: fixtureReading(),
			consumePendingMarks: () => null,
			restorePendingMarks: () => {},
			getRawSelection: () => rawSelection,
			resolveRangeEdit: (range, typed) => {
				const store = topLevelStore(node, fixtureReading({}, 'live'));
				const edit = replaceRangeInLeaf(node, range, typed, store);
				if (edit.matchesBrowserEdit) return null;
				return { raw: trimTrailingLineEnding(edit.raw), caret: edit.caret };
			}
		});
		const placement = createTypedPlacement({
			getEl: () => surface.el,
			getNode: () => node,
			reading: fixtureReading(),
			caretMemory,
			heldSpace: () => caretMemory.heldSpace.forBlock({})
		});
		const surface = makeSurface({
			compositionSeat: seat,
			caretMemory,
			getNode: () => node,
			overrides: { placeInsertion: placement.insertion }
		});
		surface.el.textContent = source;

		// The commit leaves the caret after the composed run.
		const compose = (domAfter: string, caretAt: number): void => {
			surface.setCaret(caretAt);
			surface.surface.onCompositionStart();
			surface.el.textContent = domAfter;
			surface.setCaret(caretAt + domAfter.length - source.length);
			surface.surface.onCompositionEnd();
		};
		const selectRange = (start: number, end: number): void => {
			rawSelection = { start, end };
		};
		return { surface, compose, selectRange };
	}

	describe('the composition caret position is gated on the mode, like its keydown sibling', () => {
		it('source mode commits the DOM read verbatim: the delimiter the caret touched is visible', () => {
			const { surface, compose } = makeSeatHarness(BOLD, 'far');
			compose('Some **boldかん** text', 11);
			expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual([
				'Some **boldかん** text'
			]);
		});

		it('live mode relocates the composed run through the caret position', () => {
			const { surface, compose } = makeSeatHarness(BOLD, 'far');
			surface.el.setAttribute('data-presentation', 'live');
			compose('Some **boldかん** text', 11);
			expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual([
				'Some **bold**かん text'
			]);
		});
	});

	describe('a composition over a selection takes the join', () => {
		// Selecting [9,21) crosses `**`'s closer and `*`'s opener, so a literal replace leaves both
		// marker runs unpaired on screen.
		const MIXED = 'Some **bold** and *italic* words';

		it('live mode cleans the stranded runs and lands the run at the cleaned join', () => {
			const { surface, compose, selectRange } = makeSeatHarness(MIXED, null);
			surface.el.setAttribute('data-presentation', 'live');
			selectRange(9, 21);
			compose('Some **boかんalic* words', 9);
			expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual([
				'Some boかんalic words'
			]);
		});

		it('a range whose join has nothing to clean stays the verbatim native edit', () => {
			const PLAIN = 'plain words here';
			const { surface, compose, selectRange } = makeSeatHarness(PLAIN, null);
			surface.el.setAttribute('data-presentation', 'live');
			selectRange(5, 11);
			compose('plainかん here', 5);
			expect(surface.commits.map((c) => trimTrailingLineEnding(c.text))).toEqual([
				'plainかん here'
			]);
		});
	});
});
