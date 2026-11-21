/**
 * One document's read for plugins: the `Doc` of each version, the block at a document byte, and
 * the one block view of each node. Lazy: nothing is measured until a plugin reads a position, and
 * the byte map is built once per write, over the starts the editor keeps.
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
import { documentByteMap, type DocumentByteMap } from '../../tree-operations/container-offsets';
import type { BlockBytes, Measured, TopLevelChange } from '../../tree-operations/top-level-starts';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import {
	lazyList,
	makeBlock,
	seenAt,
	walkFrom,
	type Block,
	type BlockReading,
	type Doc,
	type Seen
} from '../../schema/doc-view';
import type { BlockType } from '../../schema/plugin-unit';
import type { EditorSelection } from '../../selection/primitives';
import { checkHeldBlockPlace } from '../../invariants/held-block';
import { perfEnabled, recordHintRunsLogged } from '../../perf/instruments';
import type { WriteFollower } from './kept-starts';

export interface DocumentRead {
	/** The document as it stands: one `Doc` per version. */
	doc(): Doc;
	/** The deepest block holding document byte `at`: a byte of a marker or a container's own line
	 *  goes to the text on its line, as the caret does. Null outside the document. */
	blockAt(at: number): Block | null;
	/** The block view of `node`, seen at `path`. */
	blockOf(node: NodeView, path: readonly number[]): Block;
	/** `selection` in document bytes, `from` first; null for none or a cell selection. */
	rangeOf(selection: EditorSelection | null): { from: number; to: number } | null;
	/** The path of the deepest block holding byte `at` of a range already in the document. */
	pathAt(at: number): number[] | null;
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
	/** Tells a follower of every later write; absent for a document nothing writes to. */
	follow?(follower: WriteFollower): void;
}): DocumentRead {
	let held: Layout | null = null;
	const blocks = new WeakMap<NodeView, Block>();
	// The runs of each write since the first block was handed out: entry `i` took version
	// `logFrom + i` to the next. Null where the write couldn't say.
	const log: (readonly TopLevelChange[] | null)[] = [];
	let logFrom = 0;
	let following = false;
	let current: VersionDoc | null = null;

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
			heard({ runs, before }) {
				if (before && current?.version === deps.version()) current.keep(before);
				log.push(runs);
				recordHintRunsLogged();
				// Past this many writes a block held from before them reads -1 unless it stood still.
				if (log.length > LOG_LIMIT) logFrom += log.splice(0, log.length - LOG_LIMIT / 2).length;
			},
			keepsBefore: () => current !== null && current.version === deps.version() && current.unread
		});
	}

	function blockOf(node: NodeView, path: readonly number[] | null): Block {
		follow();
		const known = blocks.get(node);
		if (known) {
			seenAt(known, path);
			return known;
		}
		const made = makeBlock(node, reading, path);
		blocks.set(node, made);
		return made;
	}

	/** `top` moved through the writes from version `from` to `to`; null past a write that
	 *  couldn't say. `touched` says whether a write reported changing its block. */
	function moved(top: number, from: number, to: number): Moved {
		let touched = false;
		for (let v = from; v < to; v++) {
			const runs = v >= logFrom ? log[v - logFrom] : undefined;
			if (!runs) return { top: null, touched, covered: false };
			const next = shifted(top, runs);
			touched ||= next.inside;
			top = next.at;
		}
		return { top, touched, covered: true };
	}

	function find(node: NodeView, seen: Seen): readonly number[] | null {
		if (!seen.path) return null;
		const now = deps.version();
		const doc = deps.getDoc();
		let path: readonly number[] | null = seen.path;
		let move: Moved | null = null;
		if (seen.at !== now) {
			move = moved(path[0], seen.at, now);
			path = move.top === null ? null : [move.top, ...path.slice(1)];
		}
		const answer = path && blockNodeAt(doc, path) === node ? path : null;
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

	function blockAt(at: number): Block | null {
		const laid = layout();
		if (!Number.isInteger(at) || at < 0 || at > laid.of.starts.length) return null;
		const leaf = laid.map.leafAt(at);
		const node = leaf && blockNodeAt(deps.getDoc(), leaf.path);
		return node ? blockOf(node, leaf.path) : null;
	}

	const versions: VersionReads = {
		version: deps.version,
		source: deps.source,
		blocks: top,
		blockAt
	};

	return {
		doc() {
			follow();
			const version = deps.version();
			if (current?.version !== version) current = new VersionDoc(versions, deps.getDoc());
			return current;
		},
		blockAt,
		blockOf,
		rangeOf(selection) {
			if (!selection || selection.anchor.cellCoordinate || selection.focus.cellCoordinate)
				return null;
			const { map } = layout();
			const a = map.byteOf(selection.anchor.path, selection.anchor.offset);
			const f = map.byteOf(selection.focus.path, selection.focus.offset);
			return a === null || f === null ? null : { from: Math.min(a, f), to: Math.max(a, f) };
		},
		pathAt: (at) => layout().map.leafAt(at)?.path ?? null
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

const LOG_LIMIT = 1024;

interface Layout {
	of: Measured;
	map: DocumentByteMap;
}

interface Moved {
	top: number | null;
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
	blockAt(at: number): Block | null;
}

/** One version of an editor's document. Its text is read once; a write that replaces it while
 *  unread hands it the record of the bytes it had. */
class VersionDoc implements Doc {
	readonly version: number;
	readonly eol: '\n' | '\r\n';
	readonly #reads: VersionReads;
	readonly #prefix: string;
	readonly #suffix: string;
	#text: string | null = null;
	#before: BlockBytes | null = null;
	#warned = false;

	constructor(reads: VersionReads, doc: DocumentView) {
		this.#reads = reads;
		this.version = reads.version();
		this.eol = documentLineEnding(doc);
		this.#prefix = doc.prefix;
		this.#suffix = doc.suffix;
	}

	get unread(): boolean {
		return this.#text === null && this.#before === null;
	}

	keep(before: BlockBytes): void {
		this.#before = before;
	}

	get current(): boolean {
		return this.#reads.version() === this.version;
	}

	get text(): string {
		if (this.#text === null) {
			const before = this.#before;
			// A version a write replaced unkept (a load, or a throw) has only the text as it stands.
			if (!before) this.#stale('text');
			this.#text = before
				? this.#prefix + before.pieces.join('') + this.#suffix
				: this.#reads.source();
			this.#before = null;
		}
		return this.#text;
	}

	get blocks(): readonly Block[] {
		this.#stale('blocks');
		return this.#reads.blocks;
	}

	blockAt(at: number): Block | null {
		this.#stale('blockAt');
		return this.#reads.blockAt(at);
	}

	walk(): IterableIterator<Block> {
		this.#stale('walk');
		return walkFrom(this.#reads.blocks);
	}

	#stale(read: string): void {
		if (this.#warned || this.current) return;
		this.#warned = true;
		if (devChecksOn) {
			devWarn(
				'stale-doc',
				`Doc.${read} read a document a write has replaced; read \`editor.doc\` again after an await`
			);
		}
	}
}
