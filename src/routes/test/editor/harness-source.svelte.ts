// The text a test page hands its editor's `source` prop. Each load is a new object, so loading
// the text the page already holds still reaches the editor, which a `$state` string would drop.
export class HarnessSource {
	#loaded = $state.raw({ text: '' });

	constructor(initial: string) {
		this.load(initial);
	}

	get text(): string {
		return this.#loaded.text;
	}

	load(text: string): void {
		this.#loaded = { text };
	}
}
