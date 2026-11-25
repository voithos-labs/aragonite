/**
 * The editor's open drafts, and the record of what each write changed, kept only while one is open.
 * A draft holds its ranges in the bytes it opened on and maps them through every write since; a
 * write that touched one makes it stale, and its commit is one byte splice, refused with a reason
 * rather than thrown, except that a dev build also throws one started inside another write
 * (`docs/design/commit-and-undo.md` § Drafts). The drawings' saves are held here too, so the
 * undo, the redo and the mode change that close the drafts save them first.
 */

import { tick, untrack } from 'svelte';
import type { Draft, DraftCloseCause, DraftResult, DraftSpec } from '../../schema/drafts';
import type { DocumentView, NodeView } from '../../core/node-views';
import type { CommitSnapshotArg, SourceSplice } from '../../action-contracts';
import type { ByteChange } from '../../tree-operations/byte-changes';
import type { DocumentStamps } from './document-stamp';
import { startsAlone, type OpenWriteCheck } from './reading-write-gate';
import { serialize } from '../../core/serializer';
import { trimTrailingLineEnding } from '../../core/lines';
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { assertDraftBytesKept } from '../../invariants/install';
import { checkSavesCommitted } from '../../invariants/history-install';
import { docPathFrom } from '../../core/coordinate-spaces';
import { documentByteMap, leafAtByte } from '../../tree-operations/container-offsets';
import { documentLineEnding, firstLineEnding, splitLines, type ParsedLine } from '../../core/lines';
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
	/** Run by a swap, a re-read, a mode change, an undo and a redo: the held saves first, but at a
	 *  swap or a re-read (G1.246), then each block draft ends, landing nothing at those two. */
	closeAll(cause: DraftCloseCause): void;
	/** A mounted drawing's save, held until the returned release. */
	holdSave(save: () => void): () => void;
	/** Whether a write must record what it changed: true while a draft is open. */
	watching(): boolean;
	record(change: RecordedChange | null): void;
}

/** A draft the editor's own menus open, which knows where its opening bytes went. */
export interface InternalDraft extends Draft {
	/** Where byte `at` of the text it opened on sits now, or null once a write replaced it. */
	now(at: number): number | null;
	/** Ends it because the menu it was picked from closed, so a later commit says `closed`. */
	close(): void;
	/** `insertMarkdown`'s insert, at the caret or `below`: the one the plugins' paste rewrites read. */
	insertAsPaste(markdown: string, below: boolean): this;
}

/** How a draft writes; read at its commit, so the editor can build the writers after the drafts. */
export interface DraftWrites {
	commitSource(splice: SourceSplice): Promise<boolean>;
	undoStep(seed: CommitSnapshotArg, run: () => Promise<unknown>): Promise<void>;
	/** Pastes at the caret, or as a block of its own; true when bytes landed. `asksRewrites` where
	 *  the plugins' paste rewrites read the Markdown. */
	insert(markdown: string, below: boolean, asksRewrites: boolean): Promise<boolean>;
}

/** `starts` and `events` refuse a commit started while another write is open. */
export interface DraftRegistryDeps extends OpenWriteCheck {
	/** `vouch` compares what is kept of the blocks a commit's ranges and data name with the tree. */
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
	const saves = new Set<() => void>();
	// The drafts a save opens, while one runs, for the dev check that each commits before it returns.
	let saving: { committed: () => boolean }[] | null = null;
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
		const bodies: { block: Block<unknown>; text: string }[] = [];
		const inserts: { markdown: string; below: boolean; asksRewrites: boolean }[] = [];
		let lengths: number[] | null = null;
		let illegal: string | null = null;
		let ended = false;
		let closed = false;
		// Set once its commit lands or answers at once, so one waiting on a render isn't committed.
		let answered = false;
		saving?.push({ committed: () => answered || ended });
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
			if (writes.length === 0 && datas.length === 0 && bodies.length === 0)
				return write(doc, [], caret);
			const placed: PartRange[] = [];
			for (const pending of writes) {
				const at = current(pending.range);
				if (!at) return refused('moved', 'a write elsewhere changed bytes it replaces');
				placed.push(at);
			}
			const owned: Owned[] = [];
			const bodied: Owned[] = [];
			for (const [list, value] of [
				...datas.map(({ block, data }) => [owned, { block, data }] as const),
				...bodies.map(({ block, text }) => [bodied, { block, data: text }] as const)
			]) {
				const node = nodeOfBlock(value.block);
				const path = node && pathOfNode(doc, node);
				if (!node || !path) return refused('moved', 'its block was rewritten or removed');
				list.push({ ...value, node, path });
			}
			// The offsets of a range or of a block's data count the tree's bytes, so their blocks are
			// vouched before the kept starts place them: a record found wrong is forgotten, read fresh.
			for (const at of placed) deps.starts.vouch(at.from.part - 1, at.to.part - 1);
			for (const { path } of [...owned, ...bodied]) deps.starts.vouch(path[0], path[0]);
			const now = deps.measured();
			const unsorted: ByteChange[] = placed.map((at, i) => ({
				from: byteIn(now, at.from),
				to: byteIn(now, at.to),
				insert: writes[i].text
			}));
			for (const one of owned) {
				const changes = dataChanges(now, one, deps.grammar);
				if (!Array.isArray(changes)) return changes;
				for (const change of changes) unsorted.push(change);
			}
			for (const one of bodied) {
				const changes = bodyChanges(now, deps.source(), one);
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
				for (const { markdown, below, asksRewrites } of inserts)
					if (landed) landed = await writer.insert(markdown, below, asksRewrites);
			};
			if (seed && inserts.length > 0) await writer.undoStep(seed, run);
			else await run();
			return landed
				? ({ ok: true } as const)
				: refused('illegal', 'the write was refused: no caret to insert at, or it rolled back');
		}

		// A snippet's last line ending ends it, as a file's last line does; a second one is content.
		const queue = (markdown: string, below: boolean, asksRewrites: boolean): InternalDraft => {
			const text = trimTrailingLineEnding(markdown);
			if (text !== '') inserts.push({ markdown: text, below, asksRewrites });
			return made;
		};
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
			insert: (markdown) => queue(markdown, false, false),
			insertBelow: (markdown) => queue(markdown, true, false),
			insertAsPaste: (markdown, below) => queue(markdown, below, true),
			data(block, data) {
				datas.push({ block, data });
				return this;
			},
			body(block, text) {
				bodies.push({ block, text });
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
				const none = writes.length + datas.length + bodies.length + inserts.length === 0;
				answered = none && !illegal;
				if (answered) return refused('empty', 'nothing was written to it');
				try {
					// A commit made inside a render (a drawing saved as windowing removes its block)
					// lands once that render is done, as a write from inside one corrupts it.
					if ($effect.tracking()) await tick();
					answered = true;
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

	// A save's write starts inside the call, so it is the newest step when the undo reads one.
	function saveAll(): void {
		if (saves.size === 0) return;
		const begun: { committed: () => boolean }[] = [];
		if (devChecksOn) saving = begun;
		try {
			for (const save of [...saves]) save();
		} finally {
			saving = null;
		}
		assertInvariant('save-before-swap', () =>
			checkSavesCommitted(begun.filter((one) => !one.committed()).length)
		);
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
			// Untracked, so a write a save or a closer commits lands now, though a host's effect ran
			// the undo, and the undo takes it back.
			untrack(() => {
				if (cause !== 'document-swap') saveAll();
				for (const [made, spec] of [...closers]) {
					closers.delete(made);
					if (cause === 'document-swap') torn.add(made);
					spec.close(cause);
					made.end();
				}
				// The records measure a document that's gone; a re-read keeps it, and its drafts.
				for (const opened of [...open]) if (!opened.on.live) drop(opened);
				version++;
			});
		},
		holdSave(save) {
			saves.add(save);
			return () => void saves.delete(save);
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

/** A block a draft writes data into, found where the document holds it now. */
interface Owned {
	block: Block<unknown>;
	node: NodeView;
	path: number[];
	data: unknown;
}

/** The changes that write `data` into `block`: one per line that differs, so the markers of the
 *  containers around it stay. */
function dataChanges(
	laid: Measured,
	{ block, node, path, data }: Owned,
	grammar: GrammarView
): ByteChange[] | DraftResult {
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

/** The changes that write `data`, a text, as the block's body, in the bytes its type writes for it. */
function bodyChanges(
	laid: Measured,
	source: string,
	{ block, node, path, data }: Owned
): ByteChange[] | DraftResult {
	const text = data as string;
	if (text === block.body) return [];
	// A block holding any CRLF line writes CRLF, so no pair it had turns into a lone line feed.
	const ending = node.raw.includes('\r\n')
		? '\r\n'
		: (firstLineEnding(node.raw) ?? documentLineEnding(laid.doc));
	const written = makingOf(block.type)?.writeBody?.(node, text, ending) ?? null;
	if (written === null)
		return refused('illegal', `block type '${block.type.name}' takes no body like that`);
	return lineChanges(documentByteMap(laid), source, path, node.raw, written);
}

/** The changes that turn a block's bytes `was` into `now`, in document bytes: the lines between
 *  those both keep, each line added inside a container given the markers the block's lines carry. */
function lineChanges(
	map: ReturnType<typeof documentByteMap>,
	source: string,
	path: number[],
	was: string,
	now: string
): ByteChange[] {
	const a = splitLines(was);
	const b = splitLines(now);
	let head = 0;
	while (head < a.length && head < b.length && a[head].raw === b[head].raw) head++;
	let tail = 0;
	const most = Math.min(a.length, b.length) - head;
	while (tail < most && a[a.length - 1 - tail].raw === b[b.length - 1 - tail].raw) tail++;
	const gone = a.slice(head, a.length - tail);
	const added = b.slice(head, b.length - tail);
	const at = (line: ParsedLine) => map.byteOf(path, line.start)!;
	const lineStart = (byte: number) => source.lastIndexOf('\n', byte - 1) + 1;
	const markersOf = (line: ParsedLine) => source.slice(lineStart(at(line)), at(line));
	const endOf = (line: ParsedLine) => at(line) + line.raw.length;
	if (gone.length === added.length) {
		return gone.map((line, i) => ({ from: at(line), to: endOf(line), insert: added[i].raw }));
	}
	// A line after the first carries the containers' markers alone; the first may hold an item's.
	const later = a[1];
	const marks = later ? markersOf(later) : markersOf(a[0]).replace(ITEM_MARKER, spaces);
	const joined = (lines: ParsedLine[]) => lines.map((line) => marks + line.raw).join('');
	if (gone.length === 0) {
		const before = a[head];
		// Lines added after the last land past its line break; before a line, past its markers.
		const from = before ? at(before) : endOf(a[a.length - 1]);
		const insert = before ? joined(added).slice(marks.length) + marks : joined(added);
		return [{ from, to: from, insert }];
	}
	const to = endOf(gone[gone.length - 1]);
	if (added.length === 0) return [{ from: lineStart(at(gone[0])), to, insert: '' }];
	return [{ from: at(gone[0]), to, insert: joined(added).slice(marks.length) }];
}

// A list item's marker and its task box, which the lines after its first indent past.
const ITEM_MARKER = /[-*+]|\d{1,9}[.)]|\[[ xX]\]/g;
const spaces = (run: string) => ' '.repeat(run.length);

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
