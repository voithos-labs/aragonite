/**
 * How a `/` query picks rows: a prefix match on the label or a keyword, and at most one argument
 * after the first space. Pure, so the list's narrowing is testable without an editor.
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

/**
 * Whether the session outlives this query. A space ends it unless the words before it name
 * exactly one entry that takes an argument, so `and / or` stays text; the argument is one word.
 */
export function acceptsQuery(entries: readonly FilterableEntry[], query: string): boolean {
	if (/[\r\n]/.test(query)) return false;
	const { head, argument } = splitQuery(query);
	if (argument === null) return true;
	if (/\s/.test(argument)) return false;
	const named = filterEntries(entries, head);
	return named.length === 1 && named[0].takesArgument;
}
