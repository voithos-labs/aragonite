/**
 * The model-free oracle: a single expected-source string, not a shadow CST.
 * It predicts exactly one thing — printable-character insertion at the caret —
 * because the typed character is literal source regardless of how the editor
 * reclassifies the block. Every auto-behavior gesture (Enter, Tab, paste,
 * resize…) calls `resync` to adopt the observed source instead of predicting.
 *
 * Insertion lands before a single trailing newline. The editor keeps each
 * document's source ending in exactly one `\n` (empty baseline `'\n'`), so a
 * char typed at end-of-content slots in front of it. After an Enter the source
 * carries a second `\n` (the materialized empty block); inserting before the
 * last newline lands the char in that gap, matching the editor's collapse of
 * the blank line into the new block.
 */
export class ExpectationTracker {
	private src: string;

	constructor(initialSource: string) {
		this.src = initialSource;
	}

	get expectedSource(): string {
		return this.src;
	}

	appendChar(ch: string): string {
		const at = this.insertionPoint();
		this.src = this.src.slice(0, at) + ch + this.src.slice(at);
		return this.src;
	}

	backspaceAtEnd(): string {
		const at = this.insertionPoint();
		if (at > 0) this.src = this.src.slice(0, at - 1) + this.src.slice(at);
		return this.src;
	}

	resync(actualSource: string): void {
		this.src = actualSource;
	}

	private insertionPoint(): number {
		return this.src.endsWith('\n') ? this.src.length - 1 : this.src.length;
	}
}
