/** Every write permission a GitHub workflow's text grants (`contents: write`, `permissions:
 *  write-all`), in block or flow style, quoted or not, comments skipped. */
export const writeGrants = (workflow: string): string[] =>
	workflow
		.split('\n')
		.map((line) => line.replace(/(^|\s)#.*/, ''))
		.flatMap((line) =>
			[...line.matchAll(/[\w-]+['"]?:\s*['"]?write(?:-all)?\b/g)].map(([grant]) => grant)
		);
