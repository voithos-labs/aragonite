// `@types/node` is not installed, so the part of `node:fs` the recorder uses is declared here.
declare module 'node:fs' {
	export function mkdirSync(path: string, options: { recursive: boolean }): void;
	export function writeFileSync(path: string, data: string): void;
}
