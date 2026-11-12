// @vitest-environment jsdom
// The look for a wait keeps what each block answered with the first line of the block under it,
// on the editor's own `$state` tree. After every step of a drawn session there (a key, Enter, a
// move, an undo and a redo, a removal over a range, a paste), every look answers as a look that
// keeps nothing, and the tree is the parse of its bytes.
import fc from 'fast-check';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { unfinishedReadings, waitingAboveThrough, waitingInto } from '#lib/schema/block-openers.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { leafPaths } from '#lib/test/exhaustive/edit-driver.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { blocksIn, mountCase, pasteGesture, placeRange, runHistory, type Editor } from './gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const LINES = ['[b]: /v', '[b]: /v', "    'code", 'text', "end'", 'end', '# h', '2. two', ''];

const arbDocument = fc
	.record({
		lines: fc.array(fc.constantFrom(...LINES), { minLength: 2, maxLength: 8 }),
		quote: fc.boolean()
	})
	.map(({ lines, quote }) => {
		const all = ['[a]: /u', "    'code", ...lines, '', 'last'];
		return (quote ? all.map((l) => (l === '' ? '>' : `> ${l}`)) : all).join('\n') + '\n';
	});

type Step =
	| { key: string; leaf: number; at: number }
	| { press: 'Backspace' | 'Enter'; leaf: number; at: number }
	| { move: 'block.moveUp' | 'block.moveDown'; leaf: number }
	| { history: 'undo' | 'redo' }
	| { remove: number; to: number }
	| { paste: string; leaf: number };

const arbStep: fc.Arbitrary<Step> = fc.oneof(
	fc.record({ key: fc.constantFrom("'", '"', '#', ' ', 'x'), leaf: fc.nat(), at: fc.nat() }),
	fc.record({
		press: fc.constantFrom('Backspace' as const, 'Enter' as const),
		leaf: fc.nat(),
		at: fc.nat()
	}),
	fc.record({
		move: fc.constantFrom('block.moveUp' as const, 'block.moveDown' as const),
		leaf: fc.nat()
	}),
	fc.record({ history: fc.constantFrom('undo' as const, 'redo' as const) }),
	fc.record({ remove: fc.nat(), to: fc.nat() }),
	fc.record({ paste: fc.constantFrom('# p', "x'", '[c]: /w\ny'), leaf: fc.nat() })
);

const leaves = (editor: Editor) => leafPaths(editor.instance.__test.getDocument().children);

function leafAt(editor: Editor, n: number): { path: number[]; length: number } {
	const all = leaves(editor);
	const path = all[n % all.length];
	let nodes: readonly CstNode[] = editor.instance.__test.getDocument().children;
	for (const i of path.slice(0, -1)) nodes = nodes[i].children!;
	return { path, length: nodes[path.at(-1)!].raw.replace(/\r?\n$/, '').length };
}

/** A caret in the `n`th leaf; false where that leaf draws no text to put one in. */
async function caretAt(editor: Editor, n: number, at: number): Promise<boolean> {
	const { path, length } = leafAt(editor, n);
	try {
		placeCaret(surfaceAt(editor, path), at % (length + 1));
	} catch {
		return false;
	}
	await editor.settle();
	return true;
}

async function run(editor: Editor, step: Step): Promise<void> {
	const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;
	const leaf = 'leaf' in step ? step.leaf : 0;
	if ('leaf' in step && !(await caretAt(editor, leaf, 'at' in step ? step.at : 0))) return;
	if ('key' in step) {
		await insertBy('hardware key', focused(), step.key);
	} else if ('press' in step) {
		await pressHardwareKey(focused(), { key: step.press });
	} else if ('move' in step) {
		editor.instance.runCommand(step.move);
	} else if ('history' in step) {
		await runHistory(editor, step.history);
	} else if ('remove' in step) {
		const all = leaves(editor);
		const [a, b] = [step.remove % all.length, step.to % all.length].sort((x, y) => x - y);
		if (a === b) return;
		await placeRange(editor, {
			anchor: { path: all[a], offset: 0 },
			focus: { path: all[b], offset: 0 }
		});
		await pressHardwareKey(focused(), { key: 'Backspace' });
	} else {
		await pasteGesture(editor, { 'text/plain': step.paste }, 'key');
	}
	await editor.settle();
}

type Held = Pick<CstNode, 'raw' | 'leadingTrivia'>;

/** Every list of the editor's tree where the kept look and a look over fresh copies differ. */
function differences(editor: Editor): string[] {
	const readings = unfinishedReadings(editor.instance.__test.getGrammar());
	const out: string[] = [];
	const visit = (list: readonly CstNode[], where: string) => {
		const kept = (i: number): Held => list[i];
		const fresh = (i: number): Held => ({ raw: list[i].raw, leadingTrivia: list[i].leadingTrivia });
		for (let j = 1; j < list.length; j++) {
			for (const look of [waitingInto, waitingAboveThrough]) {
				const [a, b] = [look(kept, j, 0, readings), look(fresh, j, 0, readings)];
				if (a !== b) out.push(`${look.name} in ${where} at ${j}: ${a} kept, ${b} fresh`);
			}
		}
		list.forEach((node, i) => node.children && visit(node.children, `${where}${i}.`));
	};
	visit(editor.instance.__test.getDocument().children, '');
	return out;
}

async function reloaded(editor: Editor): Promise<unknown[]> {
	const fresh = mountCase(editor.source(), 'source');
	await fresh.settle();
	const blocks = blocksIn(fresh);
	return blocks;
}

const SEED = freshOrFixedSeed(20261112);

/** An edit above a pair the look kept, then a key below it: `# h` becomes `#h`, then `'` closes. */
const NAMED: [string, Step[]][] = [
	[
		"[a]: /u\n    'code\n# h\ntext\nend\n\nlast\n",
		[
			{ key: 'x', leaf: 3, at: 3 },
			{ press: 'Backspace', leaf: 2, at: 2 },
			{ key: "'", leaf: 2, at: 3 },
			{ history: 'undo' },
			{ history: 'redo' }
		]
	],
	// A key below fills the look; a quote typed into the code starts a title, the code's bytes
	// written in place; the key that closes the title lower down has to read from the definition.
	[
		'[a]: /u\n    code\n[b]: /v\nend\n\nlast\n',
		[
			{ key: 'x', leaf: 3, at: 3 },
			{ key: "'", leaf: 1, at: 4 },
			{ key: "'", leaf: 3, at: 4 }
		]
	]
];

describe('on the editor’s tree the look for a wait answers as one that keeps nothing', () => {
	it(`after every step of a drawn session, seed ${SEED}`, async () => {
		await fc.assert(
			fc.asyncProperty(
				arbDocument,
				fc.array(arbStep, { minLength: 1, maxLength: 8 }),
				async (source, steps) => {
					const editor = mountCase(source, 'source');
					await editor.settle();
					try {
						for (const step of steps) {
							await run(editor, step);
							expect(differences(editor), JSON.stringify(step)).toEqual([]);
						}
						expect(blocksIn(editor), editor.source()).toEqual(await reloaded(editor));
					} finally {
						await destroyMountedEditors();
						takeDevWarns();
					}
				}
			),
			{ numRuns: 60, seed: SEED, examples: NAMED }
		);
	}, 300_000);
});
