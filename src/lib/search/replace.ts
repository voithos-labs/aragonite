/** Expand `$1`..`$9`, `$&`/`$0` (full match), and `$$` (literal $) against a
 *  regex match's groups. Literal mode passes `undefined` groups → verbatim. */
export function expandReplacement(template: string, groups: string[] | undefined): string {
	if (!groups) return template;
	return template.replace(/\$(\$|&|\d+)/g, (_, token: string) => {
		if (token === '$') return '$';
		if (token === '&') return groups[0] ?? '';
		const n = Number(token);
		return n === 0 ? (groups[0] ?? '') : (groups[n] ?? '');
	});
}

export interface ReplaceRange {
	start: number;
	end: number;
	groups?: string[];
}

/** Apply ranges to `text`, substituting right-to-left so earlier offsets stay valid. */
export function applyRangesToText(text: string, ranges: ReplaceRange[], template: string): string {
	let out = text;
	const ordered = [...ranges].sort((a, b) => b.start - a.start);
	for (const r of ordered) {
		out = out.slice(0, r.start) + expandReplacement(template, r.groups) + out.slice(r.end);
	}
	return out;
}
