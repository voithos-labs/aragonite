/** The en_US list read into word sets, with the lookup and the suggester over them: loaded together
 *  on the first check, so an editor that never checks a word pays for none of them. */

import { AFF, DIC } from './en-us-data';
import { readHunspell } from './hunspell';

export { knownForm } from './word-form';
export { suggestFor } from './suggester';
export const words = readHunspell(AFF, DIC);
