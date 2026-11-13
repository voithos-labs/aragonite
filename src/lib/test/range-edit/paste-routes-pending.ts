// The paste route rows that wait for a ruling, each keyed to its row in the lane's delta table. A
// row here must disagree with the core: once it agrees, the route table reds until it leaves.

/** One pending row per mode and route of a named case's clipboard. */
const rows = (name: string, clip: string, why: string, routes: string[], modes: string[]) =>
	modes.flatMap((mode) =>
		routes.map((route) => [`${mode} | ${name} | ${route} | ${JSON.stringify(clip)}`, why] as const)
	);

/** Route-table row key to the delta-table row that holds it. */
export const PENDING_PASTE_ROWS: Readonly<Record<string, string>> = Object.fromEntries([
	...rows(
		'#819 after an autolink',
		'1. one',
		'U3: plain text after an autolink’s hidden closer goes inside the brackets',
		['plain menu', 'shift key'],
		['live']
	)
]);
