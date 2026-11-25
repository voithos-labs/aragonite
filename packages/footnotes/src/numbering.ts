// A label's number from the answers each top-level block gave: the order it is first cited.

// The answers are never changed once handed over, so they key the numbering: one per edit.
const numberings = new WeakMap<readonly string[], Map<string, number>>();

/** Each label's number in `cited`: the labels each top-level block cites, a space after each. */
export function numbersOf(cited: readonly string[]): Map<string, number> {
	let numbers = numberings.get(cited);
	if (numbers) return numbers;
	numbers = new Map();
	for (const labels of cited) {
		for (const label of labels.split(' ')) {
			if (label !== '' && !numbers.has(label)) numbers.set(label, numbers.size + 1);
		}
	}
	numberings.set(cited, numbers);
	return numbers;
}
