/** The en_US list read into word sets, and the suggester: loaded together on the first check, so an
 *  editor that never checks a word pays for neither. */

import { AFF, DIC } from './en-us-data';
import { readHunspell } from './hunspell';

export { suggestFor } from './suggester';
export const words = readHunspell(AFF, DIC);
