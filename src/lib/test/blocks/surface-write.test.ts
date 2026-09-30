// The one write a block makes to its own text puts the caret back only where the write left the
// block as it was: a write that changed the kind, merged or completed its line lands the caret
// itself, and a second restore from the old block would fight it.
// Miss-analysis: every write site parked a caret on `admitted` alone, and no test stubbed a write
// that reported it had placed the caret, so the field had no reader and nothing noticed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockEditActions } from '$lib/action-contracts';
import type { NodeView } from '$lib/core/node-views';
import { createSurfaceWrite, type TextWrite } from '$lib/components/blocks/surface-write';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { stubBlockEdit } from '$lib/testing/headless-actions';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockCompleter } from '$lib/schema/block-completions';
import { fixtureReading } from '../harness/fixture-grammar';

const ruleBox = definePlugin({
	name: 'rule-box',
	setup() {
		registerBlockCompleter(declarePluginKind('rule-box'), {
			onType: true,
			tryComplete: (line) =>
				line === '%%%' ? { lines: ['%%%', 'x'], caret: { path: [], line: 1, column: 0 } } : null
		});
	}
});

beforeEach(() => {
	installPlugins([ruleBox]);
});

const TYPED: Omit<TextWrite, 'text' | 'caretAfter'> = {
	intent: 'typed',
	mode: 'authored',
	source: 'input'
};

/** A block holding `raw` whose list answers every write with `keepsCaret`, the in-place write
 *  landing the new bytes at once as the real one does. */
function writerOver(raw: string, keepsCaret: boolean) {
	let node: NodeView = { kind: 'paragraph', leadingTrivia: '', raw };
	const requestCaret = vi.fn();
	const blockEdit: BlockEditActions = {
		...stubBlockEdit(),
		updateBlockContent: (_index, text, _mode, _before, after = 0) => {
			node = { ...node, raw: text };
			return withStoredCaret(Promise.resolve(true), after, undefined, keepsCaret);
		}
	};
	const writeText = createSurfaceWrite({
		getNode: () => node,
		getIndex: () => 0,
		getPath: () => [0],
		blockEdit,
		kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
		reading: fixtureReading(),
		lineEnding: () => '\n',
		getPreEditOffset: () => 0,
		requestCaret
	});
	return { writeText, requestCaret };
}

describe('the caret after a surface write', () => {
	it('is put back where a write in place left it', () => {
		const { writeText, requestCaret } = writerOver('ab\n', true);
		void writeText({ ...TYPED, text: 'abc', caretAfter: 3 });
		expect(requestCaret).toHaveBeenCalledWith(3, { source: 'input' });
	});

	it('is left to a write that places it itself', () => {
		const { writeText, requestCaret } = writerOver('ab\n', false);
		void writeText({ ...TYPED, text: '# ab', caretAfter: 2 });
		expect(requestCaret).not.toHaveBeenCalled();
	});

	it('is left to the completion a typed line gets', () => {
		const { writeText, requestCaret } = writerOver('%%\n', true);
		const write = writeText({ ...TYPED, text: '%%%', caretAfter: 3 });
		expect(requestCaret).not.toHaveBeenCalled();
		expect(write.admitted && write.keepsCaret).toBe(false);
	});

	it('is put back for the same line the editor repairs, which no completer is asked about', () => {
		const { writeText, requestCaret } = writerOver('%%\n', true);
		void writeText({ ...TYPED, intent: 'repair', text: '%%%', caretAfter: 3 });
		expect(requestCaret).toHaveBeenCalledWith(3, { source: 'input' });
	});
});
