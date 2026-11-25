/**
 * `check`'s rows over what a plugin's block type reads and writes besides its bytes: the line it
 * completes, the data it writes back through a draft, where its blocks, their text and their pieces
 * sit in the `Doc` a plugin reads, and the data a fold writes.
 */

import { splitLines, trimTrailingLineEnding } from '../core/lines';
import { makingOf, type BlockMaking } from '../schema/block-type';
import { nodeOfBlock, type Block, type Piece } from '../schema/doc-view';
import { drawingOf } from '../schema/drawing';
import type { Closable } from '../schema/container-block';
import type { Contribution } from '../schema/plugin-unit';
import type { BlockCheck, ContainerCheck } from './check-names';
import type { PluginCheckRun } from './check-context';
import type { Outcome } from './inline-check';
import { show } from './conformance-core';

/** `completion`, `dataWriteback` and `docPositions` over each of `kind`'s samples, and a
 *  container's `closable`. */
export async function blockReadOutcomes(
	run: PluginCheckRun,
	own: Contribution | undefined,
	kind: string,
	samples: readonly string[]
): Promise<[BlockCheck | ContainerCheck, Outcome][]> {
	const type = own?.blocks?.find((each) => each.name === kind);
	const making = type && makingOf(type);
	if (!making) return [];
	const rows: [BlockCheck | ContainerCheck, Outcome][] = [
		['completion', settled(() => completion(run, making, kind, samples))],
		['dataWriteback', await settledAsync(() => dataWriteback(run, making, samples))],
		['docPositions', settled(() => docPositions(run, kind, making, samples))]
	];
	const drawing = drawingOf(making.view);
	if (drawing?.edit === 'container') {
		rows.push(['closable', settled(() => closable(run, drawing.closable, samples))]);
	}
	return rows;
}

// ── Internal ─────────────────────────────────────────────────────────────────

const failed = (detail: string): Outcome => ({ status: 'failed', detail });

function settled(read: () => Outcome): Outcome {
	try {
		return read();
	} catch (error) {
		return failed(`threw: ${(error as Error)?.message ?? String(error)}`);
	}
}

async function settledAsync(read: () => Promise<Outcome>): Promise<Outcome> {
	try {
		return await read();
	} catch (error) {
		return failed(`threw: ${(error as Error)?.message ?? String(error)}`);
	}
}

/** Each prefix of each sample's first line through the type's completion, as typing it would ask. */
function completion(
	run: PluginCheckRun,
	making: BlockMaking,
	kind: string,
	samples: readonly string[]
): Outcome {
	const { completer } = making;
	if (!completer) return { status: 'not-applicable', detail: 'lists no completion' };
	const problems: string[] = [];
	let completed = 0;
	for (const sample of samples) {
		const line = splitLines(sample)[0]?.text ?? '';
		for (let end = 1; end <= line.length; end++) {
			const made = completer.tryComplete(line.slice(0, end));
			if (!made) continue;
			completed++;
			const { lines, caret } = made;
			const at = lines[caret.line];
			if (at === undefined || caret.column < 0 || caret.column > at.length) {
				problems.push(`${show(line.slice(0, end))} puts the caret outside the lines it writes`);
			} else if (run.context.parse(`${lines.join('\n')}\n`).children[0]?.kind !== kind) {
				problems.push(`${show(line.slice(0, end))} writes lines that don't read as the type`);
			}
		}
	}
	if (problems.length > 0) return failed(problems.join('; '));
	if (completed === 0) {
		return failed(
			'no prefix of a sample’s first line completes: a completion that writes lines the type ' +
				"doesn't read is refused, so it never runs"
		);
	}
	return { status: 'passed', detail: `${completed} prefix(es) complete into the type` };
}

/** Each sample's data written back through a draft, as `Draft.data` with the data it read. */
async function dataWriteback(
	run: PluginCheckRun,
	making: BlockMaking,
	samples: readonly string[]
): Promise<Outcome> {
	if (!making.writeData)
		return { status: 'not-applicable', detail: 'lists no writer for its data' };
	for (const sample of samples) {
		const stage = run.stage(sample);
		const [block] = stage.editor.doc.blocks;
		const result = await stage.editor
			.edit()
			.data(block as Block<object>, block.data as object)
			.commit();
		if (result.ok) {
			return failed(
				`writing back the data read from ${show(sample)} rewrites its bytes: ${show(stage.source())}`
			);
		}
		if (result.reason !== 'empty')
			return failed(`writing its own data back is refused: ${result.message}`);
	}
	return { status: 'passed', detail: 'each sample’s data writes back to the same bytes' };
}

/** Each sample's data closed and opened through `closable.set`, read back through `closed`, then
 *  set the same way again. */
function closable(
	run: PluginCheckRun,
	fold: Closable<unknown> | undefined,
	samples: readonly string[]
): Outcome {
	if (!fold) return { status: 'not-applicable', detail: 'lists no closable' };
	const problems: string[] = [];
	for (const sample of samples) {
		const data = run.stage(sample).editor.doc.blocks[0]?.data;
		for (const shut of [true, false]) {
			const once = fold.set(data, shut);
			const said = shut ? 'closing' : 'opening';
			if (fold.closed(once) !== shut) {
				problems.push(`${said} ${show(sample)} writes data that reads ${shut ? 'open' : 'closed'}`);
			} else if (JSON.stringify(fold.set(once, shut)) !== JSON.stringify(once)) {
				problems.push(`${said} ${show(sample)} twice writes different data`);
			}
		}
	}
	if (problems.length > 0) return failed(problems.join('; '));
	return { status: 'passed', detail: 'each sample closes and opens as its data then says' };
}

/** Each sample's `Doc`, read as `grammar(plugins).parse` reads one: every block of the type, and
 *  each inside one, at the bytes it reads, its text range inside its line, its pieces inside it. */
function docPositions(
	run: PluginCheckRun,
	kind: string,
	making: BlockMaking,
	samples: readonly string[]
): Outcome {
	const problems: string[] = [];
	let placed = 0;
	for (const sample of samples) {
		const { doc } = run.stage(sample).editor;
		for (const top of doc.blocks) {
			for (const block of top.walk()) {
				if (!insideType(block, kind)) continue;
				placed++;
				const problem =
					placeProblem(doc.text, block) ??
					(block.type.name === kind ? bodyProblem(block, making) : null) ??
					piecesProblem(doc.text, block, block.pieces);
				if (problem) problems.push(`${show(sample)}: ${problem}`);
			}
		}
	}
	if (problems.length > 0) return failed(problems.join('; '));
	return { status: 'passed', detail: `${placed} block(s) sit at the bytes they read` };
}

function insideType(block: Block, kind: string): boolean {
	for (let at: Block | null = block; at; at = at.parent) if (at.type.name === kind) return true;
	return false;
}

/** Why `block`'s bytes don't map onto the document's: each character of its text at its byte. */
function placeProblem(text: string, block: Block): string | null {
	const { from, to } = block;
	if (!(0 <= from && from <= to && to <= text.length)) {
		return `a ${block.type.name} sits at ${from}..${to}, outside the document's ${text.length} bytes`;
	}
	let last = -1;
	for (let i = 0; i < block.text.length; i++) {
		const at = block.byteAt(i);
		if (at <= last || text[at] !== block.text[i]) {
			return `a ${block.type.name}'s character ${i} isn't at document byte ${at}`;
		}
		last = at;
	}
	return null;
}

/** Why the type's text range doesn't sit inside its line, in order. */
function bodyProblem(block: Block, making: BlockMaking): string | null {
	const node = nodeOfBlock(block);
	const range = node && making.bodyRange?.(node);
	if (!node || !range) return null;
	const { start, end } = range;
	const line = trimTrailingLineEnding(node.raw).length;
	if (start > end) return `its text range ${start}..${end} runs backwards`;
	if (start < 0 || end > line)
		return `its text range ${start}..${end} leaves its ${line}-byte line`;
	return null;
}

function piecesProblem(text: string, block: Block, pieces: readonly Piece[]): string | null {
	for (const piece of pieces) {
		if (!(block.from <= piece.from && piece.from <= piece.to && piece.to <= block.to)) {
			return `a ${piece.kind} piece at ${piece.from}..${piece.to} isn't inside its block`;
		}
		if (piece.kind === 'text' && text.slice(piece.from, piece.to) !== piece.text) {
			return `a text piece reads ${show(piece.text)} where the document holds ${show(text.slice(piece.from, piece.to))}`;
		}
		const inner = piecesProblem(text, block, piece.children);
		if (inner) return inner;
	}
	return null;
}
