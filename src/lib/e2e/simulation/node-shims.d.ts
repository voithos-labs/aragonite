// `@types/node` isn't installed (see platform.ts's `declare const process`),
// so the slice of `node:fs` the recorder uses at capture time is declared here
// rather than pulling in a full type package for two functions.
declare module 'node:fs' {
	export function mkdirSync(path: string, options: { recursive: boolean }): void;
	export function writeFileSync(path: string, data: string): void;
}
