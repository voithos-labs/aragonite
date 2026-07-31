/**
 * The model-free oracle: one expected-source string, not a shadow CST. It predicts exactly
 * ONE thing — printable insertion at the caret — because the typed character is literal
 * source regardless of how the editor reclassifies the block; every auto-behavior gesture
 * calls `resync` instead. Insertion lands before the single trailing newline the editor
 * keeps, which is also the gap an Enter's materialized empty block leaves.
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
