# Feature: The key after a typed alert marker

A quote whose first line gets typed into `[!TIP]` becomes an alert, and its text stays as the alert's body. The caret doesn't jump anywhere surprising: the next key lands at the start of the body, in source and live mode alike.

## Happy paths

- `> [!TI\n> body\n`, caret after `[!TI`, type `P]`, then `x`: the source is `> [!TIP]\n> xbody\n`, in source and live mode

## Edge cases

- The same quote inside a list item, `- > [!TI\n  > body\n`: `- > [!TIP]\n  > xbody\n`, in source and live mode (the typing write now reads the landing off the caret's byte in the new alert rather than re-entering the container at its start; miss-analysis: no test typed the marker into a quote below the root, where the re-entry went through the list item's own focus walk)
