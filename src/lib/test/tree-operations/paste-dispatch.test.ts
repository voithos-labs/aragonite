// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	pasteDispatch,
	pickPasteStrategy,
	defaultInlineHook,
	defaultStructuralHook,
	__getDefaultTextSurface
} from '../../tree-operations/paste-dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '../../tree-operations/paste-surfaces';
import { parse } from '../../core/parser';
import type { BlockKind, CstNode, Document } from '../../core/nodes';
import type { BlockEditActions } from '../../contracts';
import type { UndoController } from '../../components/editor-actions/deps';

function makePara(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

describe('paste-dispatch — strategy selection', () => {
	it('picks inline for a single-paragraph clipboard', () => {
		const parsed = parse('just some text\n');
		expect(pickPasteStrategy(parsed)).toBe('inline');
	});

	it('picks structural for multiple paragraphs', () => {
		const parsed = parse('para one\n\npara two\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single heading', () => {
		const parsed = parse('# just a heading\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single list', () => {
		const parsed = parse('- just an item\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});

	it('picks structural for a single code block', () => {
		const parsed = parse('```\ncode\n```\n');
		expect(pickPasteStrategy(parsed)).toBe('structural');
	});
});

describe('paste-dispatch — default inline hook', () => {
	it('splices text at offset into raw', () => {
		const node = makePara('hello world\n');
		const result = defaultInlineHook(node, 5, ' XYZ');
		expect(result.newRaw).toBe('hello XYZ world\n');
		expect(result.caretOffset).toBe(9);
	});

	it('with preDelete: removes range then splices', () => {
		const node = makePara('hello world\n');
		const result = defaultInlineHook(node, 0, 'XYZ', { start: 0, end: 5 });
		expect(result.newRaw).toBe('XYZ world\n');
		expect(result.caretOffset).toBe(3);
	});

	it('preserves CRLF line ending', () => {
		const node = makePara('hello\r\n');
		const result = defaultInlineHook(node, 5, '!');
		expect(result.newRaw).toBe('hello!\r\n');
	});

	it('with empty preDelete range is equivalent to no preDelete', () => {
		const node = makePara('hello\n');
		const a = defaultInlineHook(node, 3, 'X', { start: 3, end: 3 });
		const b = defaultInlineHook(node, 3, 'X');
		expect(a).toEqual(b);
	});
});

describe('paste-dispatch — default structural hook', () => {
	it('delegates to buildPastedReplacement for a single heading', () => {
		const node = makePara('target\n');
		const blocks = parse('# heading\n').children;
		const result = defaultStructuralHook(node, 6, blocks);
		expect(result.replacement.length).toBeGreaterThan(0);
		expect(result.focusReplacementIndex).toBe(result.replacement.length - 1);
	});

	it('produces a replacement sequence for multi-block input', () => {
		const node = makePara('target\n');
		const blocks = parse('# heading\n\npara\n').children;
		const result = defaultStructuralHook(node, 6, blocks);
		expect(result.replacement.length).toBeGreaterThanOrEqual(2);
	});
});

describe('paste-dispatch — default text surface descriptor', () => {
	it('provides both hooks', () => {
		const surface = __getDefaultTextSurface('paragraph');
		expect(surface.onInlinePaste).toBeDefined();
		expect(surface.onStructuralPaste).toBeDefined();
	});

	it('kind matches the requested kind', () => {
		expect(__getDefaultTextSurface('paragraph').kind).toBe('paragraph');
		expect(__getDefaultTextSurface('heading').kind).toBe('heading');
	});
});

// ── Dev-mode opaque-fallback warning ─────────────────────────────────────

function makeDocWithOneBlock(kind: BlockKind, raw: string): Document {
	return {
		kind: 'document',
		prefix: '',
		suffix: '',
		children: [
			{
				kind,
				leadingTrivia: '',
				raw,
				metadata: {}
			}
		]
	};
}

function makeStubBlockEdit(): BlockEditActions {
	return {
		splitBlock: vi.fn(),
		mergeWithPrevious: vi.fn(),
		mergeWithNext: vi.fn(),
		deleteBlock: vi.fn(),
		updateBlockContent: vi.fn(),
		updateBlockMetadata: vi.fn(),
		insertParsedBlocks: vi.fn(),
		replaceBlock: vi.fn()
	};
}

function makeStubController(): UndoController {
	return {
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn(),
		clearDebouncedCheckpoint: vi.fn()
	} as unknown as UndoController;
}

describe('paste-dispatch opaque-fallback warning', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
	});

	it('warns in dev mode when target kind has no registered surface', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const doc = makeDocWithOneBlock('indentedCode', 'plain\n');
		await pasteDispatch(
			{ pastedText: 'hello', targetPath: [0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() }
		);

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('No paste surface registered for kind'),
			expect.stringContaining('indentedCode'),
			expect.any(String)
		);

		warn.mockRestore();
	});

	it('does not warn when target kind has a registered surface', async () => {
		registerPasteSurface({
			kind: 'paragraph',
			onInlinePaste: (node, offset, text) => ({
				newRaw: node.raw.slice(0, offset) + text + node.raw.slice(offset),
				caretOffset: offset + text.length
			}),
			onStructuralPaste: () => ({ replacement: [], focusReplacementIndex: 0, focusOffset: 0 })
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const doc = makeDocWithOneBlock('paragraph', 'hello\n');
		await pasteDispatch(
			{ pastedText: 'X', targetPath: [0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeStubController() }
		);

		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
