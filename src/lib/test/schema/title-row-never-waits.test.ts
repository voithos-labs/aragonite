// @vitest-environment jsdom
// A title row has no reading of its own, so it never waits on a line below, by every reader of a wait.
// Miss-analysis: no reader of a wait was asked about a container's own children, so a `:::` opener
// row answered "waiting" above every block in its body and hid the opener typed under it.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '#lib';
import { registeredAdmonitions } from '#lib/test/harness/registered-admonitions.js';
import {
	closedWaitsOf,
	unfinishedReadings,
	waitingAboveClosedBy,
	waitingAboveThrough,
	waitingInto
} from '#lib/schema/block-openers.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { DIRECTIVE_OPENER_LINE } from '#lib/core/directive/container-shape.js';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const ROW = DIRECTIVE_OPENER_LINE as AnyBlockKind;
const block = (raw: string, kind: AnyBlockKind = 'paragraph') => ({ raw, leadingTrivia: '', kind });
const readings = () => unfinishedReadings(defaultGrammarView);
const admonitions = registeredAdmonitions();

beforeEach(() => installPlugins([admonitions]));

describe('the readers of a wait pass over a title row', () => {
	it('a typed closer finishes the opener under the row, not the row', () => {
		const list = [block('::::note\n', ROW), block(':::tip\n'), block('in\n')];
		expect(waitingAboveClosedBy([':::'], (i) => list[i], 3, readings())).toBe(1);
	});

	it('the row waits under no closed reading', () => {
		expect(closedWaitsOf(block('::::note\n', ROW), readings())).toEqual([]);
		expect(closedWaitsOf(block('::::note\n'), readings())).not.toEqual([]);
	});

	// A wait no line closes: bytes that read as a definition whose title is still open.
	type List = ReturnType<typeof block>[];
	const definition = (kind: AnyBlockKind): List => [
		block('[a]: /u\n', kind),
		block("'a title still open\n")
	];
	it.each([
		['waitingInto', (list: List) => waitingInto((i) => list[i], 1, 0, readings())],
		['waitingAboveThrough', (list: List) => waitingAboveThrough((i) => list[i], 1, 0, readings())]
	])('%s', (_, ask) => {
		expect(ask(definition('paragraph'))).toBe(0);
		expect(ask(definition(ROW))).toBe(-1);
	});
});

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** The bytes, the caret and the read-back after `keys` from `offset` of the block at `path`. */
async function typeIn(source: string, path: number[], offset: number, keys: string[]) {
	const editor = mountEditor({ source, presentationMode: 'live', plugins: [admonitions] });
	await editor.settle();
	placeCaret(surfaceAt(editor, path), offset);
	await editor.settle();
	for (const key of keys) {
		await pressHardwareKey(document.activeElement as HTMLElement, { key });
		await editor.settle();
	}
	const instance = editor.instance as unknown as {
		getSelection(): { focus: unknown } | null;
		__test: { getDocument(): Parameters<typeof describeConvergence>[0] };
	};
	return {
		source: editor.source(),
		focus: instance.getSelection()?.focus,
		diverged: describeConvergence(instance.__test.getDocument()),
		warns: takeDevWarns().map((warn) => warn.tag)
	};
}

const CONTAINER = [':', ':', ':', 't', 'i', 'p', 'Enter', 'i', 'n', 'Enter', ':', ':', ':'];

// The caret after the closer is where the same keys leave it at the top level: the end of `in`.
describe('a container typed in a callout body is read as it is typed', () => {
	it.each([
		['top level, the control', 'para\n', [0], 4, ['Enter', ...CONTAINER], [1, 1]],
		['as the body first line', '::::note\n\n::::\n', [0, 1], 0, CONTAINER, [0, 1, 1]],
		['after a body line', '::::note\nbody\n::::\n', [0, 1], 4, ['Enter', ...CONTAINER], [0, 2, 1]]
	])('%s', async (_, source, path, offset, keys, inPath) => {
		const got = await typeIn(source, path, offset, keys);
		expect(got.diverged).toBeNull();
		expect(got.warns).toEqual([]);
		expect(got.focus).toEqual({ path: inPath, offset: 2 });
	});
});
