/**
 * Whether a version satisfies an npm range, for the dev check on a plugin's `editor` field. Covers
 * what a manifest writes: an exact version, `^`, `~`, comparators, `x` or `*`, and `||`.
 */
export function satisfiesRange(version: string, range: string): boolean {
	const parsed = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!parsed) return false;
	const v: Version = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
	return range.split('||').some((set) =>
		set
			.trim()
			.split(/\s+/)
			.every((comparator) => matches(v, comparator))
	);
}

type Version = [number, number, number];

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The first version past the range: component `at` one higher, everything after it zero.
const bump = (v: Version, at: number): Version =>
	v.map((n, i) => (i < at ? n : i === at ? n + 1 : 0)) as Version;

function matches(v: Version, comparator: string): boolean {
	if (comparator === '' || comparator === '*' || comparator === 'x') return true;
	const m = /^(\^|~|[<>]=?|=)?v?(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?$/.exec(comparator);
	if (!m) return false;
	const op = m[1] ?? '';
	const given = [m[2], m[3], m[4]].filter((part) => part !== undefined && !/[x*]/.test(part));
	const low = [0, 1, 2].map((i) => Number(given[i] ?? 0)) as Version;
	const order = compare(v, low);
	if (op === '>=') return order >= 0;
	if (op === '>') return order > 0;
	if (op === '<=') return order <= 0;
	if (op === '<') return order < 0;
	const firstNonZero = low.findIndex((n, i) => n !== 0 && i < given.length);
	const at =
		op === '^'
			? firstNonZero === -1
				? given.length - 1
				: firstNonZero
			: op === '~'
				? Math.min(given.length - 1, 1)
				: given.length - 1;
	if ((op === '' || op === '=') && given.length === 3) return order === 0;
	return order >= 0 && compare(v, bump(low, at)) < 0;
}
