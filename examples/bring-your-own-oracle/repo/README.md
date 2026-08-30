# duration-kit

Parses the durations our config files are written in.

## The contract

`parseDuration(input)` takes a duration written as a sequence of number and unit
pairs and returns the total in milliseconds. The units are `h`, `m` and `s`.

| Input | Returns |
| --- | ---: |
| `"90s"` | `90000` |
| `"30m"` | `1800000` |
| `"1h30m"` | `5400000` |
| `"2h15m30s"` | `8130000` |

A string that is not a whole sequence of number and unit pairs is rejected with
an error rather than parsed into whatever prefix happens to match. `""`,
`"1h30"`, `"h"` and `"1d"` are all errors.

`formatDuration(ms)` is the inverse for whole units, and is used in log lines.
