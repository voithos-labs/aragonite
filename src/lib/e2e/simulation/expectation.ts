/**
 * The model-free oracle: one expected-source string, not a shadow CST. It predicts exactly
 * ONE thing — printable insertion at the caret — because the typed character is literal
 * source regardless of how the editor reclassifies the block; every auto-behavior gesture
 * calls `resync` instead. Insertion lands before the single trailing newline the editor
 * keeps, which is also the gap an Enter's materialized empty block leaves. The one auto
 * behavior it does model is delimiter auto-pair, through the editor's own resolver.
 */
import {
	resolveDelimiterAutoPair,
	resolveEmptyPairBackspace
} from '../../components/blocks/text/delimiter-autopair';
import { isBuiltinBlockKind } from '../../core/nodes';
import { parse } from '../../core/parser';

/** Kinds whose surface carries no auto-pair arm: a typed byte there is literal. */
const NO_PAIR_KINDS = new Set(['fencedCode', 'indentedCode', 'htmlBlock', 'thematicBreak']);

export class ExpectationTracker {
	private src: string;
	/** Bytes the editor wrote past the caret (an auto-pair twin, a completed fence's closer);
	 *  the caret sits before them. */
	private twin = '';

	constructor(initialSource: string) {
		this.src = initialSource;
	}

	get expectedSource(): string {
		return this.src;
	}

	appendChar(ch: string): string {
		const at = this.insertionPoint();
		const lineStart = this.src.lastIndexOf('\n', at - 1) + 1;
		const line = this.src.slice(lineStart, at + this.twin.length);
		const caret = at - lineStart;
		const edit = this.pairs()
			? resolveDelimiterAutoPair(
					line,
					{ start: 0, end: line.length },
					caret,
					ch,
					(next) => kindOfLine(next) === kindOfLine(line)
				)
			: null;
		if (edit?.kind === 'step-over') {
			this.twin = this.twin.slice(1);
		} else if (edit) {
			this.src = this.src.slice(0, lineStart) + edit.text + this.src.slice(at + this.twin.length);
			this.twin = edit.text.slice(edit.caret);
		} else {
			this.src = this.src.slice(0, at) + ch + this.src.slice(at);
		}
		return this.src;
	}

	backspaceAtEnd(): string {
		const at = this.insertionPoint();
		const lineStart = this.src.lastIndexOf('\n', at - 1) + 1;
		const line = this.src.slice(lineStart, at + this.twin.length);
		const pair = this.twin ? resolveEmptyPairBackspace(line, at - lineStart) : null;
		if (pair && pair.kind === 'write') {
			this.src = this.src.slice(0, lineStart) + pair.text + this.src.slice(at + this.twin.length);
			this.twin = pair.text.slice(pair.caret);
		} else if (at > 0) {
			this.src = this.src.slice(0, at - 1) + this.src.slice(at);
		}
		return this.src;
	}

	/** A resync keeps a held twin only while the document still ends in it. */
	resync(actualSource: string): void {
		this.src = actualSource;
		const tail = this.src.endsWith('\n') ? this.src.slice(0, -1) : this.src;
		if (!tail.endsWith(this.twin)) this.twin = '';
	}

	/** Bytes a gesture knows the editor wrote past the caret, e.g. a completed fence's closer. */
	holdTwin(twin: string): void {
		this.twin = twin;
	}

	releaseTwin(): void {
		this.twin = '';
	}

	/** The caret: before the trailing newline, and before any twin held past it. */
	private insertionPoint(): number {
		const end = this.src.endsWith('\n') ? this.src.length - 1 : this.src.length;
		return end - this.twin.length;
	}

	private pairs(): boolean {
		const last = parse(this.src).children.at(-1);
		return last !== undefined && isBuiltinBlockKind(last.kind) && !NO_PAIR_KINDS.has(last.kind);
	}
}

function kindOfLine(line: string): string | undefined {
	return parse(line + '\n').children[0]?.kind;
}
