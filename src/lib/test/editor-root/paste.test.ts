// @vitest-environment jsdom
// The editor's one paste entry: which paste events it takes, where it aims each, and what it
// leaves to the browser (a text field in the root, a plugin's own editable, a block with no
// answer, an event something already handled).
// Miss-analysis: each block bound its own paste handler, so nothing asked of one place which
// events the editor takes, and a field inside the root kept its paste only by binding none.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRootPaste } from '#lib/components/editor-root/paste.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { registerEditor, __resetActiveEditorForTests } from '#lib/active-editor.js';
import { parse } from '#lib/core/parser.js';
import { createEditorEvents, type EditorError } from '#lib/editor-events.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { SourceSplice } from '#lib/action-contracts.js';
import type { PasteImageHook } from '#lib/host-hooks.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { changedBytes } from '#lib/tree-operations/byte-changes.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { freshBytes } from '#lib/test/harness/copied-text.js';
import { WHOLE_BLOCK_INPUT_ATTR } from '#lib/selection/whole-block-input.js';
import { leafWriteLands } from '#lib/editor-actions/paste-coordinator.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

// The fake commits record their bytes and write none, so no document here holds a paste to check.
vi.mock('#lib/invariants/install.js', async (original) => ({
	...(await original<typeof import('#lib/invariants/install.js')>()),
	assertPasteLanded: () => {}
}));

interface HarnessOptions {
	onPasteImage?: PasteImageHook;
	/** Reading mode, or a document a swap replaced: the editor takes no write. */
	refuses?: boolean;
	plain?: boolean;
	stale?: boolean;
}

const SOURCE = 'hello\n\n---\n\nworld\n';

function harness(options: HarnessOptions = {}) {
	const root = document.createElement('div');
	root.tabIndex = -1;
	document.body.append(root);
	registerEditor(root);
	const header = root.appendChild(document.createElement('header'));

	const selection = createSelectionState();
	const doc = parse(SOURCE);
	const commits: SourceSplice[] = [];
	const ranged: string[] = [];
	const opened: number[] = [];
	const steps: number[][] = [];
	const leafWrites: { path: number[]; raw: string }[] = [];
	const restored: { path: number[]; offset: number }[] = [];
	const events = createEditorEvents();
	const errors: EditorError[] = [];
	events.on('error', (e) => errors.push(e));
	const blocks = new Map<string, Partial<BlockComponent>>();
	const els = new Map<string, HTMLElement>();
	const bytes = freshBytes(() => doc);

	/** A block's element in the root, editable unless told otherwise. */
	function block(path: number[], component: Partial<BlockComponent>, editable = true) {
		const el = root.appendChild(document.createElement('div'));
		el.setAttribute('data-block-path', JSON.stringify(path));
		if (editable) el.setAttribute('contenteditable', 'true');
		blocks.set(path.join(), component);
		els.set(path.join(), el);
		return el;
	}

	const paste = createRootPaste({
		get editorEl() {
			return root;
		},
		selection,
		context: {
			bytes,
			reading: fixtureReading(),
			controller: {
				admitsGesture: () => !options.refuses,
				undoStep: async (seed: { path: readonly number[] }, run: () => Promise<unknown>) => {
					steps.push([...seed.path]);
					await run();
				},
				flushDebouncedCheckpoint: () => {},
				commitSource: async (splice: SourceSplice) => (commits.push(splice), true)
			},
			selection,
			getDoc: () => doc,
			activePlugins: everyInstalledPlugin,
			pasteCoordinator: {
				writeLeaf: (path: readonly number[], raw: string, _before: number, caret: number) => {
					leafWrites.push({ path: [...path], raw });
					return Object.assign(Promise.resolve(true), { admitted: true, keepsCaret: false, caret });
				},
				landsAsWritten: (path: readonly number[], raw: string) =>
					leafWriteLands(doc, path, raw, defaultGrammarView)
			},
			caretLanding: {
				restore: async (to: { anchor: { path: number[]; offset: number } }) => {
					restored.push({ path: [...to.anchor.path], offset: to.anchor.offset });
					return 'applied';
				}
			}
		} as never,
		pasteOverRange: async (clip) => (ranged.push(clip.text), true),
		insertParagraph: async (boundary) => (opened.push(boundary), false),
		getBlockComponent: (path) => (blocks.get(path.join()) as BlockComponent) ?? null,
		getBlockElByPath: (path) => els.get(path.join()) ?? null,
		plainPaste: () => options.plain ?? false,
		onPasteImage: () => options.onPasteImage,
		events,
		isHostChrome: (node) => !!node && header.contains(node),
		stamps: { current: () => ({ live: !options.stale }) } as never
	});

	function fire(
		target: EventTarget | null,
		{ text = 'P', files = [] as File[], prevented = false } = {}
	) {
		let preventCount = prevented ? 1 : 0;
		const event = {
			type: 'paste',
			target,
			get defaultPrevented() {
				return preventCount > 0;
			},
			preventDefault: () => void preventCount++,
			clipboardData: {
				types: text ? ['text/plain'] : [],
				files,
				getData: (type: string) => (type === 'text/plain' ? text : '')
			}
		} as unknown as ClipboardEvent;
		paste.onPasteEvent(event, root);
		return { taken: preventCount > (prevented ? 1 : 0) };
	}

	/** The bytes each splice the paste committed leaves. */
	const written = () =>
		commits.map((splice) => changedBytes(SOURCE, 0, SOURCE.length, splice.changes));
	return {
		root,
		header,
		selection,
		paste,
		block,
		fire,
		ranged,
		opened,
		steps,
		commits,
		leafWrites,
		restored,
		written,
		errors
	};
}

const pngFile = () => new File([new Uint8Array([137, 80])], 'shot.png', { type: 'image/png' });
const answers = (start: number, end = start) => vi.fn(() => ({ start, end }));

beforeEach(() => {
	__resetActiveEditorForTests();
	document.body.replaceChildren();
});

describe('which paste events the editor takes', () => {
	it('takes a paste in a block’s own text, and asks the block where', () => {
		const h = harness();
		const preparePaste = vi.fn(() => null);
		const el = h.block([0], { preparePaste });
		const inner = el.appendChild(document.createElement('span'));

		expect(h.fire(inner).taken).toBe(true);
		expect(preparePaste).toHaveBeenCalledOnce();
	});

	it.each([
		['an input', () => document.createElement('input')],
		['a textarea', () => document.createElement('textarea')]
	])('leaves %s inside a block its own paste', (_, make) => {
		const h = harness();
		const preparePaste = vi.fn(() => null);
		const field = h.block([0], { preparePaste }, false).appendChild(make());

		expect(h.fire(field).taken).toBe(false);
		expect(preparePaste).not.toHaveBeenCalled();
	});

	it('leaves a plugin’s own editable field inside a block its paste', () => {
		const h = harness();
		const preparePaste = vi.fn(() => null);
		const view = h.block([0], { preparePaste }, false);
		// The block's text is elsewhere; the field is an editing host of the plugin's own.
		const field = h.root.appendChild(document.createElement('div'));
		field.setAttribute('data-block-path', '[0]');
		field.setAttribute('contenteditable', 'true');
		void view;

		expect(h.fire(field).taken).toBe(false);
		expect(preparePaste).not.toHaveBeenCalled();
	});

	it('leaves the browser the paste in an editable block that answers no paste', () => {
		const h = harness();
		const el = h.block([0], { focusable: true });

		expect(h.fire(el).taken).toBe(false);
		expect(h.commits).toEqual([]);
	});

	it('leaves an event a block already handled', () => {
		const h = harness();
		const preparePaste = vi.fn(() => null);
		const el = h.block([0], { preparePaste });

		expect(h.fire(el, { prevented: true }).taken).toBe(false);
		expect(preparePaste).not.toHaveBeenCalled();
	});

	it('leaves the host’s header and an element outside the root', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 5 });
		const outside = document.body.appendChild(document.createElement('div'));

		expect(h.fire(h.header).taken).toBe(false);
		expect(h.fire(outside).taken).toBe(false);
		expect(h.ranged).toEqual([]);
	});

	it('takes a paste at the body over the range the editor holds', async () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 5 });

		expect(h.fire(document.body).taken).toBe(true);
		await vi.waitFor(() => expect(h.ranged).toEqual(['P']));
	});

	it('takes nothing at the body with no range, gap or widget held', () => {
		const h = harness();
		expect(h.fire(document.body).taken).toBe(false);
	});

	it('leaves the body’s paste to the editor that holds the claim', () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 5 });
		const other = document.body.appendChild(document.createElement('div'));
		registerEditor(other);

		expect(h.fire(document.body).taken).toBe(false);
	});
});

describe('where a paste is aimed', () => {
	it('lands under a block focused whole, a blank line apart', async () => {
		const h = harness();
		const box = h.block([1], { focusable: true }, false);
		const proxy = box.appendChild(document.createElement('div'));
		proxy.setAttribute(WHOLE_BLOCK_INPUT_ATTR, '');
		proxy.setAttribute('contenteditable', 'true');

		expect(h.fire(proxy, { text: 'new' }).taken).toBe(true);
		await vi.waitFor(() => expect(h.written()).toEqual(['hello\n\n---\n\nnew\n\nworld\n']));
		expect(h.commits[0].op).toEqual({ kind: 'paste', detail: { count: 1 } });
	});

	it('hands the block’s answer to the core as that block’s bytes', async () => {
		const h = harness();
		const el = h.block([0], { preparePaste: answers(1, 4) });

		h.fire(el, { text: 'one\n\ntwo' });
		await vi.waitFor(() => expect(h.written()).toEqual(['hone\n\ntwoo\n\n---\n\nworld\n']));
	});

	// Miss-analysis: every paste over a selection changed its bytes, so none saw a copy pasted over
	// itself, which writes nothing and has no commit to end the selection.
	it('ends a selection pasted over with its own bytes as a caret after them', async () => {
		const h = harness();
		const el = h.block([0], { preparePaste: answers(1, 4) });

		h.fire(el, { text: 'ell' });
		await vi.waitFor(() => expect(h.restored).toEqual([{ path: [0], offset: 4 }]));
		expect(h.commits).toEqual([]);
		expect(h.leafWrites).toEqual([]);
	});

	it('asks nothing of a block the editor may not write to', () => {
		const h = harness({ refuses: true });
		const preparePaste = answers(0);
		const el = h.block([0], { preparePaste });

		// Taken all the same: the browser's paste would write where the editor refuses to.
		expect(h.fire(el).taken).toBe(true);
		expect(preparePaste).not.toHaveBeenCalled();
	});

	it('pastes nothing from an empty clipboard, and lets the block’s records go', async () => {
		const h = harness();
		const finish = vi.fn();
		const el = h.block([0], { preparePaste: () => ({ start: 0, end: 0, finish }) as never });

		h.fire(el, { text: '' });
		await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(true));
		expect(h.commits).toEqual([]);
	});

	it('a menu’s paste asks the block as the clipboard arrives, not at the press', async () => {
		const h = harness();
		const preparePaste = answers(5);
		const el = h.block([0], { preparePaste });
		el.tabIndex = 0;
		el.focus();

		const aimed = h.paste.aim();
		expect(preparePaste).not.toHaveBeenCalled();
		await aimed?.({ text: '!', plain: false });
		// Text in one block is that block's own write, never the splice.
		expect(h.leafWrites).toEqual([{ path: [0], raw: 'hello!\n' }]);
		expect(h.commits).toEqual([]);
	});

	it('`below` opens a paragraph under the top-level block holding the caret, in one undo step', async () => {
		const h = harness();
		const el = h.block([2, 0], { preparePaste: answers(2) });
		el.tabIndex = 0;
		el.focus();

		// The harness opens none, so nothing is pasted: the paste goes nowhere else.
		expect(await h.paste.paste({ text: '- item', plain: false }, { below: true })).toBe(false);
		expect(h.opened).toEqual([3]);
		expect(h.steps).toEqual([[2]]);
		expect(h.commits).toEqual([]);
	});

	// Miss-analysis: the draft arm's rows read the text it wrote, never what the paste answered, so
	// a paste a shown source took was reported as one that went nowhere.
	it('answers a paste a shown source drafted as taken, with no commit', async () => {
		const h = harness();
		const drafted: string[] = [];
		const draft = (text: string) => void drafted.push(text);
		const el = h.block([0], { preparePaste: () => ({ start: 2, end: 2, draft }) as never });
		el.tabIndex = 0;
		el.focus();

		expect(await h.paste.paste({ text: 'x', plain: false })).toBe(true);
		expect(drafted).toEqual(['x']);
		expect(h.commits).toEqual([]);
		expect(h.leafWrites).toEqual([]);
	});

	it('refuses a paste made for a document a swap replaced', async () => {
		const h = harness({ stale: true });
		const el = h.block([0], { preparePaste: answers(0) });
		el.tabIndex = 0;
		el.focus();

		expect(await h.paste.paste({ text: 'x', plain: false })).toBe(false);
		expect(h.commits).toEqual([]);
	});
});

describe('a paste carrying images', () => {
	it('prevents before the import, then pastes what the host answers where it was aimed', async () => {
		const imported: string[] = [];
		const h = harness({
			onPasteImage: async (image) => (imported.push(image.suggestedName ?? ''), '![[shot.png]]')
		});
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 5 });

		expect(h.fire(document.body, { text: '', files: [pngFile()] }).taken).toBe(true);
		await vi.waitFor(() => expect(h.ranged).toEqual(['![[shot.png]]']));
		expect(imported).toEqual(['shot.png']);
	});

	it('replaces a range the editor came to hold while the import ran', async () => {
		let answer: (markdown: string) => void = () => {};
		const h = harness({ onPasteImage: () => new Promise((resolve) => (answer = resolve)) });
		const finish = vi.fn();
		const el = h.block([0], { preparePaste: () => ({ start: 0, end: 0, finish }) as never });

		h.fire(el, { text: '', files: [pngFile()] });
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 5 });
		answer('![[shot.png]]');

		await vi.waitFor(() => expect(h.ranged).toEqual(['![[shot.png]]']));
		expect(finish).toHaveBeenCalledWith(true);
		expect(h.leafWrites).toEqual([]);
	});

	it('asks the block where before the import waits', () => {
		const h = harness({ onPasteImage: () => new Promise(() => {}) });
		const preparePaste = answers(0);
		const el = h.block([0], { preparePaste });

		h.fire(el, { text: '', files: [pngFile()] });
		expect(preparePaste).toHaveBeenCalledOnce();
	});

	it('reports an imported image that found nowhere to land', async () => {
		const h = harness({ onPasteImage: async () => '![[shot.png]]' });
		const el = h.block([0], { preparePaste: () => null });

		h.fire(el, { text: '', files: [pngFile()] });
		await vi.waitFor(() => expect(h.errors.map((e) => e.origin)).toEqual(['clipboard']));
	});

	it('reports nothing for an imported image a shown source drafted', async () => {
		const h = harness({ onPasteImage: async () => '![[shot.png]]' });
		const drafted: string[] = [];
		const draft = (text: string) => void drafted.push(text);
		const el = h.block([0], { preparePaste: () => ({ start: 0, end: 0, draft }) as never });

		h.fire(el, { text: '', files: [pngFile()] });
		await vi.waitFor(() => expect(drafted).toEqual(['![[shot.png]]']));
		await Promise.resolve();
		expect(h.errors).toEqual([]);
	});

	it('reports a host import that fails, and pastes nothing', async () => {
		const h = harness({
			onPasteImage: async () => {
				throw new Error('disk full');
			}
		});
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 5 });

		h.fire(document.body, { text: '', files: [pngFile()] });
		await vi.waitFor(() => expect(h.errors.map((e) => e.origin)).toEqual(['clipboard']));
		expect(h.ranged).toEqual([]);
	});

	it('pastes the text when no hook is installed', async () => {
		const h = harness();
		h.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 5 });

		h.fire(document.body, { text: 'T', files: [pngFile()] });
		await vi.waitFor(() => expect(h.ranged).toEqual(['T']));
		expect(h.errors).toEqual([]);
	});
});
