/**
 * Keeps "Add to dictionary" words in the browser's localStorage under `key`, for a host with nowhere
 * else to keep them; spread the result into the dictionary's options. Nothing is stored unless a
 * host calls this, and a storage that refuses costs only the word after a reload.
 */
export function localStorageWords(key: string): {
	words: string[];
	onAddWord: (word: string) => void;
} {
	return {
		words: read(key),
		onAddWord(word) {
			// Read again first, so a word another tab saved meanwhile stays.
			const saved = read(key);
			if (saved.includes(word)) return;
			try {
				globalThis.localStorage?.setItem(key, JSON.stringify([...saved, word]));
			} catch {
				// Full or blocked: the dictionary still holds the word until a reload.
			}
		}
	};
}

function read(key: string): string[] {
	try {
		const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]');
		return Array.isArray(saved) ? saved.filter((word) => typeof word === 'string') : [];
	} catch {
		return [];
	}
}
