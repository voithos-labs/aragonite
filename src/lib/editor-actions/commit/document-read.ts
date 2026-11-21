/**
 * One document's read for plugins: the `Doc` of each version, the block at a document byte, the
 * one block view of each node, and what an `edit` listener gets. Lazy: nothing is measured until a
 * plugin reads a position, and the byte map is built once per write, over the kept starts.
 *
 * A held block finds its node again without walking the document. It keeps where it was last
 * seen, moves that top-level index through the runs each write reports, and answers only where the
 * node at the moved path is its own: anywhere else it has left the document, and reads -1.
 */
import { assertInvariant, devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { DocumentView, NodeView } from '../../core/node-views';
import type { AnyBlockKind } from '../../core/nodes';
import { documentLineEnding } from '../../core/lines';
import { resolvedInlineContent, type InlineReading } from '../../core/inline/inline-cache';
import {
	documentByteMap,
	type DocumentByteMap,
	type LeafPosition
} from '../../tree-operations/container-offsets';
import {
	piecesOf,
	type BlockBytes,
	type Measured,
	type TopLevelChange
} from '../../tree-operations/top-level-starts';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import {
	lazyList,
	makeBlock,
	seenAt,
	walkFrom,
	type Block,
	type BlockReading,
	type Doc,
	type KeyWatch,
	type Seen
} from '../../schema/doc-view';
import type { BlockType } from '../../schema/plugin-unit';
import type { EditEvent, EditInfo } from '../../editor-events';
import { checkHeldBlockPlace } from '../../invariants/held-block';
import {
	perfEnabled,
	recordBlockRead,
	recordHintRunsLogged,
	recordStringsKept
} from '../../perf/instruments';
import type { WriteFollower } from './kept-starts';
import { createEditChanges } from './edit-changes';
import { watchKeys } from './block-keys';

export interface DocumentRead {
	/** The document at `version`, the current one by default: one `Doc` per version. One a write
	 *  has replaced reads the document as it stands, and has only that text. */
	doc(version?: number): Doc;
	/** The deepest block holding document byte `at`: a byte of a marker or a container's own line
	 *  goes to the text on its line, as the caret does. Null outside the document. */
	blockAt(at: number): Block | null;
	/** The block view of `node`, seen at `path`. */
	blockOf(node: NodeView, path: readonly number[]): Block;
	/** Offset `offset` of the block at `path` as a document byte; null where it isn't placed. */
	byteOf(path: readonly number[], offset: number): number | null;
	/** The text position holding document byte `at`, as a caret lands there. Null outside the
	 *  document. */
	leafAt(at: number): LeafPosition | null;
	/** The path of the deepest block holding byte `at` of a range already in the document. */
	pathAt(at: number): number[] | null;
	/** The text blocks bytes `[from, to)` cross, in order, each with the offsets of its part. */
	leavesIn(from: number, to: number): { path: number[]; start: number; end: number }[];
	/** What an `edit` listener gets for one emitted edit: one object for every listener. */
	editInfo(event: EditEvent): EditInfo;
	/** Counts an `edit` listener in, so each write keeps what `changes` needs; returns the way out. */
	listenForEdits(): () => void;
	/** Asks `depends` of every top-level block now, then of the blocks each write replaced. */
	keys(depends: (block: Block) => string, report: (cause: unknown) => void): KeyWatch;
}

export function createDocumentRead(deps: {
	getDoc(): DocumentView;
	/** That document with the starts the editor keeps for it, a new pair after every write. */
	measured(): Measured;
	typeOf(kind: AnyBlockKind): BlockType<unknown>;
	reading: InlineReading;
	/** Bumped by every write that changes the bytes; read without subscribing. */
	version(): number;
	/** The document's text as it stands. */
	source(): string;
	/** Tells a follower of every later write until the returned call; absent for a document
	 *  nothing writes to. */
	follow?(follower: WriteFollower): () => void;
}): DocumentRead {
	let held: Layout | null = null;
	const blocks = new WeakMap<NodeView, Block>();
	// The runs of each write since the first block was handed out: entry `i` took version
	// `logFrom + i` to the next. Null where the write couldn't say.
	const log: (readonly TopLevelChange[] | null)[] = [];
	let logFrom = 0;
	let following = false;
	let current: VersionDoc | null = null;
	// The latest write's replaced strings, chained on from the first write that replaced a `Doc`
	// handed out unread, so that `Doc` rebuilds its text when asked; null while no chain runs.
	let undone: Undone | null = null;
	let chained = 0;
	const changes = createEditChanges();
	const infos = new WeakMap<EditEvent, EditInfo>();

	function layout(): Layout {
		const of = deps.measured();
		if (held?.of !== of) held = { of, map: documentByteMap(of) };
		return held;
	}

	function follow(): void {
		if (following || !deps.follow) return;
		following = true;
		logFrom = deps.version();
		deps.follow({
			heard(write) {
				const { runs, before } = write;
				const replaced = current?.version === deps.version() && current.unread ? current : null;
				if (replaced || undone) {
					if (!undone) chained = 0;
					undone = undoneBy(undone, deps.version(), runs, before, replaced);
					// The `Doc` the write replaced is its holder's now, not the read's to keep.
					if (replaced) current = null;
					// Past this many writes a `Doc` from before them reads the text as it stands.
					if (++chained >= LOG_LIMIT) undone = null;
				}
				changes.heard(write, deps.getDoc());
				log.push(runs);
				recordHintRunsLogged();
				// Past this many writes a block held from before them reads -1 unless it stood still.
				if (log.length > LOG_LIMIT) logFrom += log.splice(0, log.length - LOG_LIMIT / 2).length;
			},
			readsBefore: () => changes.listening() || undone !== null || current?.unread === true
		});
	}

	function blockOf(node: NodeView, path: readonly number[] | null, at?: number): Block {
		follow();
		recordBlockRead();
		const known = blocks.get(node);
		if (known) {
			seenAt(known, path, at);
			return known;
		}
		const made = makeBlock(node, reading, path, at);
		blocks.set(node, made);
		return made;
	}

	/** `top` moved through the writes from version `from` to `to`, kept where a write couldn't say
	 *  for the node there to confirm; `touched` says a write reported changing its block. */
	function moved(top: number, from: number, to: number): Moved {
		let touched = false;
		let covered = true;
		for (let v = from; v < to; v++) {
			const runs = v >= logFrom ? log[v - logFrom] : undefined;
			if (!runs) {
				covered = false;
				continue;
			}
			const next = shifted(top, runs);
			touched ||= next.inside;
			top = next.at;
		}
		return { top, touched, covered };
	}

	function find(node: NodeView, seen: Seen): readonly number[] | null {
		if (!seen.path) return null;
		const now = deps.version();
		const doc = deps.getDoc();
		let path: readonly number[] = seen.path;
		let move: Moved | null = null;
		if (seen.at !== now) {
			move = moved(path[0], seen.at, now);
			path = [move.top, ...path.slice(1)];
		}
		const answer = blockNodeAt(doc, path) === node ? path : null;
		if (move && devChecksOn && !perfEnabled() && seen.checked !== now) {
			seen.checked = now;
			assertInvariant('held-block-place', () => checkHeldBlockPlace(doc, node, answer, move));
		}
		if (!answer) return null;
		seen.path = answer;
		seen.at = now;
		return answer;
	}

	const reading: BlockReading = {
		typeOf: deps.typeOf,
		blockOf,
		find,
		nodeAt: (path) => blockNodeAt(deps.getDoc(), path),
		byteOf: (path, offset) => layout().map.byteOf(path, offset),
		ownEnd: (path) => layout().map.ownEnd(path),
		inline: (node) => resolvedInlineContent(node, deps.reading),
		version: deps.version
	};

	const top = lazyList(
		() => deps.getDoc().children.length,
		(i) => blockOf(deps.getDoc().children[i], [i])
	);

	// Null outside the document: the byte map alone would answer with its last text.
	function leafAt(at: number): LeafPosition | null {
		const laid = layout();
		if (!Number.isInteger(at) || at < 0 || at > laid.of.starts.length) return null;
		return laid.map.leafAt(at);
	}

	function blockAt(at: number): Block | null {
		const leaf = leafAt(at);
		const node = leaf && blockNodeAt(deps.getDoc(), leaf.path);
		return node ? blockOf(node, leaf.path) : null;
	}

	// By index, off the document's own list: the lazy list pays a trap and a string for each read.
	function* tops(): Generator<Block> {
		for (let i = 0; ; i++) {
			const { children } = deps.getDoc();
			if (i >= children.length) return;
			yield blockOf(children[i], [i]);
		}
	}

	const versions: VersionReads = {
		version: deps.version,
		source: deps.source,
		blocks: top,
		tops,
		blockAt,
		textBefore: (head) => textBefore(head, deps.getDoc(), deps.version())
	};

	function doc(version = deps.version()): Doc {
		follow();
		if (version !== deps.version()) return new VersionDoc(versions, deps.getDoc(), version);
		if (current?.version !== version) current = new VersionDoc(versions, deps.getDoc(), version);
		return current;
	}

	return {
		doc,
		blockAt,
		blockOf,
		byteOf: reading.byteOf,
		leafAt,
		pathAt: (at) => leafAt(at)?.path ?? null,
		leavesIn(from, to) {
			const { map } = layout();
			const out: { path: number[]; start: number; end: number }[] = [];
			for (let at = from; at < to;) {
				const leaf = leafAt(at);
				const end = leaf && map.ownEnd(leaf.path);
				if (!leaf || end === null) break;
				// A container's own closing line reads as the child before it, already taken.
				if (end > at) {
					const stop = map.offsetIn(leaf.path, Math.min(to, end));
					out.push({ path: leaf.path, start: leaf.offset, end: stop });
				}
				at = Math.max(end, at + 1);
			}
			return out;
		},
		editInfo(event) {
			let info = infos.get(event);
			if (!info) {
				const version = deps.version();
				let read: Doc | undefined;
				const docOf = () => (read ??= doc(version));
				const worked = changes.take(() => docOf().text);
				info = {
					op: event.op,
					detail: event.detail,
					timestamp: event.timestamp,
					get doc() {
						return docOf();
					},
					get changes() {
						return worked();
					}
				} as EditInfo;
				infos.set(event, info);
			}
			return info;
		},
		listenForEdits() {
			follow();
			return changes.listen();
		},
		keys: (depends, report) =>
			watchKeys({ follow: deps.follow ?? (() => () => {}), blocks: () => top }, depends, report)
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

const LOG_LIMIT = 1024;

interface Layout {
	of: Measured;
	map: DocumentByteMap;
}

interface Moved {
	top: number;
	touched: boolean;
	covered: boolean;
}

/** Top-level index `i` past one write's runs: in document order, each `at` counted before any of
 *  them. One inside a run keeps its place from the run's start, within what the run put in. */
function shifted(i: number, runs: readonly TopLevelChange[]): { at: number; inside: boolean } {
	let delta = 0;
	for (const run of runs) {
		if (i < run.at) break;
		if (i < run.at + run.removed) {
			const within = Math.min(i - run.at, Math.max(run.inserted - 1, 0));
			return { at: run.at + delta + within, inside: true };
		}
		delta += run.inserted - run.removed;
	}
	return { at: i + delta, inside: false };
}

interface VersionReads {
	version(): number;
	source(): string;
	blocks: readonly Block[];
	/** Those blocks in order, for a walk. */
	tops(): Iterable<Block>;
	blockAt(at: number): Block | null;
	/** The top-level strings before the writes chained from `head`; null where one couldn't say. */
	textBefore(head: Undone): string[] | null;
}

/** One write's runs and the strings each run replaced, chained to the next write. A write that
 *  couldn't say keeps the whole record before it instead, which the kept starts then let go of. */
interface Undone {
	readonly from: number;
	readonly runs: readonly TopLevelChange[] | null;
	readonly gone: readonly (readonly string[])[];
	readonly whole: readonly string[] | null;
	next: Undone | null;
}

function undoneBy(
	tail: Undone | null,
	from: number,
	runs: readonly TopLevelChange[] | null,
	before: BlockBytes | null,
	replaced: VersionDoc | null
): Undone {
	// A record holds two strings a block: its leading trivia and its bytes.
	const gone =
		runs && before ? runs.map((r) => before.pieces.slice(2 * r.at, 2 * (r.at + r.removed))) : [];
	recordStringsKept(gone.reduce((sum, strings) => sum + strings.length, 0));
	const whole = !runs && before ? before.pieces : null;
	const next: Undone = { from, runs: before ? runs : null, gone, whole, next: null };
	if (tail) tail.next = next;
	replaced?.since(next);
	return next;
}

/** The document's top-level strings as they stood before `head`'s write, rebuilt by undoing every
 *  write chained since, latest first, from the tree or from the next whole record. */
function textBefore(head: Undone, doc: DocumentView, now: number): string[] | null {
	const chain: Undone[] = [];
	let pieces: string[] | null = null;
	for (let at: Undone | null = head; at && !pieces; at = at.next) {
		if (at.whole) pieces = [...at.whole];
		else if (!at.runs) return null;
		else chain.push(at);
	}
	// Every announced write is heard, so a gap means the chain can't be trusted.
	if (!pieces && head.from + chain.length !== now) return null;
	pieces ??= piecesOf(doc.children, 0, doc.children.length);
	for (let k = chain.length - 1; k >= 0; k--) {
		const { runs, gone } = chain[k];
		let delta = 0;
		const after = runs!.map((run) => {
			const at = run.at + delta;
			delta += run.inserted - run.removed;
			return at;
		});
		// Joined, not spread into `splice`: a run can replace a document's worth of blocks.
		for (let r = runs!.length - 1; r >= 0; r--) {
			const at = 2 * after[r];
			pieces = pieces.slice(0, at).concat(gone[r], pieces.slice(at + 2 * runs![r].inserted));
		}
	}
	return pieces;
}

/** One version of an editor's document. Its text is read once; read after a write replaced it,
 *  it's rebuilt from the tree and the strings each write since replaced. */
class VersionDoc implements Doc {
	readonly version: number;
	readonly eol: '\n' | '\r\n';
	readonly #reads: VersionReads;
	readonly #prefix: string;
	readonly #suffix: string;
	#text: string | null = null;
	#undone: Undone | null = null;

	constructor(reads: VersionReads, doc: DocumentView, version: number) {
		this.#reads = reads;
		this.version = version;
		this.eol = documentLineEnding(doc);
		this.#prefix = doc.prefix;
		this.#suffix = doc.suffix;
		// Frozen, as a block is: a proxy over a `Doc` can't read its private fields.
		Object.freeze(this);
	}

	get unread(): boolean {
		return this.#text === null && this.#undone === null;
	}

	/** The write that replaced this version, the first of those its text is rebuilt past. */
	since(write: Undone): void {
		this.#undone = write;
	}

	get current(): boolean {
		return this.#reads.version() === this.version;
	}

	get text(): string {
		if (this.#text === null) {
			const pieces = this.#undone && this.#reads.textBefore(this.#undone);
			// A version past a write that couldn't say (a load, or a throw) has only the text as it stands.
			if (!pieces) warnStale(this, 'text');
			this.#text = pieces ? this.#prefix + pieces.join('') + this.#suffix : this.#reads.source();
			this.#undone = null;
		}
		return this.#text;
	}

	get blocks(): readonly Block[] {
		warnStale(this, 'blocks');
		return this.#reads.blocks;
	}

	blockAt(at: number): Block | null {
		warnStale(this, 'blockAt');
		return this.#reads.blockAt(at);
	}

	walk(): IterableIterator<Block> {
		warnStale(this, 'walk');
		return walkFrom(this.#reads.tops());
	}
}

const warned = new WeakSet<Doc>();

// Once per `Doc`, in a dev build: a production build carries neither the check nor its words.
function warnStale(doc: Doc, read: string): void {
	if (!devChecksOn || doc.current || warned.has(doc)) return;
	warned.add(doc);
	devWarn(
		'stale-doc',
		`Doc.${read} read a document a write has replaced; read \`editor.doc\` again after an await`
	);
}
