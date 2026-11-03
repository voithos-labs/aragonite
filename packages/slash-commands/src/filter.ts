/**
 * How a `/` query picks rows: a prefix match on the label or a keyword, and at most one argument
 * after the first space, which goes to one row. Pure, so the list's narrowing is testable without
 * an editor.
 */

export interface FilterableEntry {
	readonly label: string;
	readonly keywords: readonly string[];
	readonly takesArgument: boolean;
}

export interface SplitQuery {
	/** The words before the first space: what names the entry. */
	head: string;
	/** What follows the first space, or null when the query has none. */
	argument: string | null;
}

export function splitQuery(query: string): SplitQuery {
	const space = query.search(/\s/);
	if (space === -1) return { head: query, argument: null };
	return { head: query.slice(0, space), argument: query.slice(space + 1) };
}

/** The entries whose label or a keyword starts with `head`, ignoring case, in their given order. */
export function filterEntries<T extends FilterableEntry>(entries: readonly T[], head: string): T[] {
	const wanted = head.toLowerCase();
	return entries.filter(
		(entry) =>
			entry.label.toLowerCase().startsWith(wanted) ||
			entry.keywords.some((keyword) => keyword.toLowerCase().startsWith(wanted))
	);
}

/** What a query lists, and the word after the space when the one listed entry takes it. */
export interface QueryReading<T> {
	listed: T[];
	argument: string | null;
}

/** How a query reads, or null if it ends the session. A label typed in full, spaces and all, lists
 *  its row; otherwise the one word after the first space goes to one entry, or the space ends it. */
export function readQuery<T extends FilterableEntry>(
	entries: readonly T[],
	query: string
): QueryReading<T> | null {
	if (/[\r\n]/.test(query)) return null;
	const whole = filterEntries(entries, query);
	const { head, argument } = splitQuery(query);
	if (argument === null) return { listed: whole, argument: null };
	const entry = /\s/.test(argument) ? null : argumentTaker(entries, head);
	// A space with no word yet keeps the row the word would go to, first, so Enter still picks it.
	if (entry && argument === '') {
		return { listed: [entry, ...whole.filter((other) => other !== entry)], argument: null };
	}
	if (whole.length > 0) return { listed: whole, argument: null };
	return entry ? { listed: [entry], argument } : null;
}

/** Whether the session outlives this query. */
export function acceptsQuery(entries: readonly FilterableEntry[], query: string): boolean {
	return readQuery(entries, query) !== null;
}

// The only entry `head` matches, or else the one argument-taking entry whose label's first word or
// a keyword is exactly `head`.
function argumentTaker<T extends FilterableEntry>(entries: readonly T[], head: string): T | null {
	const named = filterEntries(entries, head);
	if (named.length === 1) return named[0].takesArgument ? named[0] : null;
	const wanted = head.toLowerCase();
	const exact = named.filter(
		(entry) =>
			entry.takesArgument &&
			(entry.label.split(/\s/)[0].toLowerCase() === wanted ||
				entry.keywords.some((keyword) => keyword.toLowerCase() === wanted))
	);
	return exact.length === 1 ? exact[0] : null;
}
