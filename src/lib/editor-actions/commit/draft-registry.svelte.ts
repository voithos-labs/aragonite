/**
 * The editor's open drafts, and the record of what each write changed, kept only while one is open.
 * A draft holds its ranges in the bytes it opened on and maps them through every write since; a
 * write that touched one makes it stale, and its commit is one byte splice, refused with a reason
 * rather than thrown, except that a dev build also throws one started inside another write
 * (`docs/design/commit-and-undo.md` § Drafts).
 */

import type { Draft, DraftCloseCause, DraftResult, DraftSpec } from '../../schema/drafts';
import type { DocumentView } from '../../core/node-views';
import type { CommitSnapshotArg, SourceSplice } from '../../action-contracts';
import type { ByteChange } from '../../tree-operations/byte-changes';
import type { DocumentStamps } from './document-stamp';
import { startsAlone, type OpenWriteCheck } from './reading-write-gate';
import { serialize } from '../../core/serializer';
import { devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { assertDraftBytesKept } from '../../invariants/install';
import { docPathFrom } from '../../core/coordinate-spaces';
import { documentByteMap, leafAtByte } from '../../tree-operations/container-offsets';
import { splitLines } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import { makingOf } from '../../schema/block-type';
import { nodeOfBlock, type Block } from '../../schema/doc-view';
import type { Measured } from '../../tree-operations/top-level-starts';
import type { KeptStarts } from './kept-starts';
import {
	blockRange,
	pathOfNode,
	byteAt,
	byteIn,
	lengthsBefore,
	partLengths,
	positionAt,
	rangeThrough,
	type PartRange,
	type RecordedChange
} from './change-record';

export interface DraftRegistry {
	/** An edit against the document as it is now; one a plugin opens is refused once it's off, and
	 *  one watching a range goes stale when a write touches it. */
	edit(plugin?: string, watch?: { from: number; to: number }): InternalDraft;
	/** A block's draft over the bytes of the block at `path`, or over none, which the editor closes
	 *  through `spec` until it ends. */
	open(spec: DraftSpec, path?: readonly number[]): Draft;
	/** A document swap, a re-read, a mode change, and an undo or redo call it; each block draft it
	 *  closes is ended, and at a swap or a re-read it can't land, since its block is torn down. */
	closeAll(cause: DraftCloseCause): void;
	/** Whether a write must record what it changed: true while a draft is open. */
	watching(): boolean;
	record(change: RecordedChange | null): void;
}

/** A draft whose Markdown can also go into a new paragraph below the caret's block. */
export interface InternalDraft extends Draft {
	insertBelow(markdown: string): this;
	/** Where byte `at` of the text it opened on sits now, or null once a write replaced it. */
	now(at: number): number | null;
	/** Ends it because the menu it was picked from closed, so a later commit says `closed`. */
	close(): void;
}

/** How a draft writes; read at its commit, so the editor can build the writers after the drafts. */
export interface DraftWrites {
	commitSource(splice: SourceSplice): Promise<boolean>;
	undoStep(seed: CommitSnapshotArg, run: () => Promise<unknown>): Promise<void>;
	/** Pastes at the caret, or into a new paragraph after its top-level block; true when bytes landed. */
	insert(markdown: string, below: boolean): Promise<boolean>;
}

/** `starts` and `events` refuse a commit started while another write is open. */
export interface DraftRegistryDeps extends OpenWriteCheck {
	/** `vouch` compares what is kept of the blocks a commit's ranges name with the tree. */
	readonly starts: Pick<KeptStarts, 'writing' | 'vouch'>;
	stamps: Pick<DocumentStamps, 'current' | 'historySwapping'>;
	doc(): DocumentView;
	/** That document with the starts the editor keeps for it. */
	measured(): Measured;
	/** Its bytes, serialized once per content version. */
	source(): string;
	isReading(): boolean;
	/** Whether the editor still runs the plugin. */
	isOn(plugin: string): boolean;
	grammar: GrammarView;
	writes(): DraftWrites;
}

export function createDraftRegistry(deps: DraftRegistryDeps): DraftRegistry {
	// The writes since the oldest open draft opened; `base` numbers the first.
	let log: RecordedChange[] = [];
	let base = 0;
	const open = new Set<Opened>();
	const closers = new Map<Draft, DraftSpec>();
	const torn = new WeakSet<Draft>();
	// Read by `stale`, so a box drawn from it hears a write while it is open.
	let version = $state(0);
	// A draft nobody holds can never commit, so it stops costing writes once collected.
	const collected = new FinalizationRegistry<Opened>((opened) => drop(opened));

	function drop(opened: Opened): void {
		open.delete(opened);
		let oldest = base + log.length;
		for (const { start } of open) oldest = Math.min(oldest, start);
		log = log.slice(oldest - base);
		base = oldest;
	}

	function draft(
		watched: PartRange | null,
		onEnd: (made: Draft) => void,
		plugin?: string
	): InternalDraft {
		const openedOn = deps.stamps.current();
		// The bytes it opened on, for the dev check that no write went unrecorded.
		const openedText = devChecksOn ? serialize(deps.doc()) : '';
		const opened = { start: base + log.length, on: openedOn };
		const gone = () => !openedOn.live || torn.has(made);
		open.add(opened);
		const since = () => (open.has(opened) ? log.slice(opened.start - base) : []);
		const writes: { range: PartRange; text: string }[] = [];
		const datas: { block: Block<unknown>; data: unknown }[] = [];
		const inserts: { markdown: string; below: boolean }[] = [];
		let lengths: number[] | null = null;
		let illegal: string | null = null;
		let ended = false;
		let closed = false;
		// Fixed at its end, since an ended draft stops hearing writes.
		let touchedAtEnd = false;

		const current = (range: PartRange): PartRange | null => {
			let at: PartRange | null = range;
			for (const change of since()) if (!(at = at && rangeThrough(at, change))) return null;
			return at;
		};

		const touched = () =>
			touchedAtEnd || [watched, ...writes.map((w) => w.range)].some((r) => r && !current(r));

		function end(): void {
			if (ended) return;
			touchedAtEnd = touched();
			ended = true;
			drop(opened);
			collected.unregister(made);
			onEnd(made);
		}

		async function land(caret: number | undefined): Promise<DraftResult> {
			if (!startsAlone(deps, { kind: 'replaceBlock' }))
				return refused('busy', 'it was committed inside another write');
			if (gone()) return refused('unloaded', 'another document replaced the one it opened on');
			if (plugin !== undefined && !deps.isOn(plugin))
				return refused('off', `plugin '${plugin}' was turned off in this editor`);
			if (deps.isReading()) return refused('reading', 'the editor is in reading mode');
			if (deps.stamps.historySwapping())
				return refused('moved', 'an undo was replacing the document');
			if (illegal) return refused('illegal', illegal);
			const doc = deps.doc();
			if (writes.length === 0 && datas.length === 0) return write(doc, [], caret);
			const placed: PartRange[] = [];
			for (const pending of writes) {
				const at = current(pending.range);
				if (!at) return refused('moved', 'a write elsewhere changed bytes it replaces');
				placed.push(at);
			}
			// A range's offsets count the tree's bytes, so its blocks are vouched before the kept
			// starts place them: a record found wrong is forgotten, and the read below is fresh.
			for (const at of placed) deps.starts.vouch(at.from.part - 1, at.to.part - 1);
			const now = deps.measured();
			const unsorted: ByteChange[] = placed.map((at, i) => ({
				from: byteIn(now, at.from),
				to: byteIn(now, at.to),
				insert: writes[i].text
			}));
			for (const { block, data } of datas) {
				const changes = dataChanges(deps.measured(), block, data, deps.grammar);
				if (!Array.isArray(changes)) return changes;
				for (const change of changes) unsorted.push(change);
			}
			const changes = [...unsorted].sort((a, b) => a.from - b.from || a.to - b.to);
			for (let i = 1; i < changes.length; i++) {
				if (changes[i].from < changes[i - 1].to || changes[i].from === changes[i - 1].from)
					return refused('overlap', `two of its ranges meet at byte ${changes[i].from}`);
			}
			const text = deps.source();
			if (devChecksOn && lengths) {
				const was = writes.map(({ range }) => ({
					from: byteAt(lengths!, range.from),
					to: byteAt(lengths!, range.to)
				}));
				assertDraftBytesKept(
					openedText,
					text,
					was.map((at, i) => ({ was: at, is: { from: unsorted[i].from, to: unsorted[i].to } }))
				);
			}
			const split = changes.find(
				(c) => splitsLineEnding(text, c.from) || splitsLineEnding(text, c.to)
			);
			if (split) return refused('illegal', `a range splits the line ending at byte ${split.from}`);
			const changed = changes.filter((c) => text.slice(c.from, c.to) !== c.insert);
			if (changed.length === 0 && inserts.length === 0)
				return refused('empty', 'it writes only the bytes already there');
			return write(doc, changed, caret);
		}

		async function write(doc: DocumentView, changes: ByteChange[], caret: number | undefined) {
			// A draft needs no record of its own write.
			drop(opened);
			const writer = deps.writes();
			const seed = changes.length > 0 ? snapshotAt(deps.measured(), changes[0].from) : null;
			let landed = true;
			const run = async () => {
				if (seed) {
					landed = await writer.commitSource({
						changes,
						caret: caret === undefined ? 'keep' : { at: caret, holds: 'text' },
						op: { kind: 'replaceBlock', detail: { source: 'draft' } },
						snapshot: seed
					});
				}
				for (const { markdown, below } of inserts)
					if (landed) landed = await writer.insert(markdown, below);
			};
			if (seed && inserts.length > 0) await writer.undoStep(seed, run);
			else await run();
			return landed
				? ({ ok: true } as const)
				: refused('illegal', 'the write was refused: no caret to insert at, or it rolled back');
		}

		const made: InternalDraft = {
			get stale() {
				void version;
				return gone() || touched();
			},
			replace(range, text) {
				lengths ??= lengthsBefore(partLengths(deps.doc()), since());
				const total = lengths.reduce((sum, length) => sum + length, 0);
				const { from, to } = range;
				if (!(
					Number.isInteger(from) &&
					Number.isInteger(to) &&
					0 <= from &&
					from <= to &&
					to <= total
				))
					illegal ??= `replace(${from}, ${to}) is outside the document's ${total} bytes`;
				else
					writes.push({
						range: { from: positionAt(lengths, from), to: positionAt(lengths, to) },
						text
					});
				return this;
			},
			insert(markdown) {
				if (markdown !== '') inserts.push({ markdown, below: false });
				return this;
			},
			data(block, data) {
				datas.push({ block, data });
				return this;
			},
			insertBelow(markdown) {
				inserts.push({ markdown, below: true });
				return this;
			},
			close() {
				closed = !ended;
				end();
			},
			now(at) {
				lengths ??= lengthsBefore(partLengths(deps.doc()), since());
				const position = positionAt(lengths, at);
				const mapped = current({ from: position, to: position });
				return mapped && byteAt(partLengths(deps.doc()), mapped.from);
			},
			async commit(options) {
				if (closed) return refused('closed', 'the menu it was picked from closed first');
				if (ended) return refused('empty', 'the draft was ended');
				if (writes.length === 0 && datas.length === 0 && inserts.length === 0 && !illegal)
					return refused('empty', 'nothing was written to it');
				try {
					return await land(options?.caret);
				} finally {
					end();
				}
			},
			end
		};
		collected.register(made, opened, made);
		return made;
	}

	return {
		edit(plugin, watch) {
			const lengths = watch && partLengths(deps.doc());
			const watched = lengths && {
				from: positionAt(lengths, watch.from),
				to: positionAt(lengths, watch.to)
			};
			return draft(watched || null, () => {}, plugin);
		},
		open(spec, path) {
			const watched = path ? blockRange(deps.doc(), path) : null;
			const made = draft(watched, (ended) => closers.delete(ended));
			closers.set(made, spec);
			return made;
		},
		closeAll(cause) {
			for (const [made, spec] of [...closers]) {
				closers.delete(made);
				if (cause === 'document-swap') torn.add(made);
				spec.close(cause);
				made.end();
			}
			// The records measure a document that's gone; a re-read keeps it, and its drafts.
			for (const opened of [...open]) if (!opened.on.live) drop(opened);
			version++;
		},
		watching: () => open.size > 0,
		record(change) {
			if (!change || open.size === 0) return;
			log.push(change);
			version++;
		}
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The changes that write `data` into `block` as the document holds it now: one per line that
 *  differs, so the markers of the containers around it stay. */
function dataChanges(
	laid: Measured,
	block: Block<unknown>,
	data: unknown,
	grammar: GrammarView
): ByteChange[] | DraftResult {
	const node = nodeOfBlock(block);
	const path = node && pathOfNode(laid.doc, node);
	if (!node || !path) return refused('moved', 'its block was rewritten or removed');
	const map = documentByteMap(laid);
	const byteOf = (offset: number) => map.byteOf(path, offset);
	const written = makingOf(block.type)?.writeData?.(node, data, grammar) ?? null;
	if (written === null)
		return refused('illegal', `block type '${block.type.name}' has no writer for that data`);
	const was = splitLines(node.raw);
	const now = splitLines(written);
	if (was.length !== now.length)
		return refused('illegal', 'that data changes how many lines the block has');
	return was.flatMap((line, i) =>
		line.text === now[i].text
			? []
			: [
					{
						from: byteOf(line.start)!,
						to: byteOf(line.start + line.text.length)!,
						insert: now[i].text
					}
				]
	);
}

/** An open draft: where its writes start in the log, and the document it was opened on. */
interface Opened {
	start: number;
	on: { readonly live: boolean };
}

function refused(
	reason: Exclude<DraftResult, { ok: true }>['reason'],
	message: string
): DraftResult {
	return { ok: false, reason, message };
}

const splitsLineEnding = (text: string, at: number) => text[at - 1] === '\r' && text[at] === '\n';

/** Where undo puts the caret back when nothing is focused: the text at byte `at`. */
function snapshotAt(measured: Measured, at: number): CommitSnapshotArg {
	const leaf = leafAtByte(measured, at);
	return leaf
		? { path: docPathFrom(leaf.path), offset: leaf.offset }
		: { path: docPathFrom([0]), offset: 0 };
}
