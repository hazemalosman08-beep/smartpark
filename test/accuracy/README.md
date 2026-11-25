# Accuracy checks

Hand-made answer keys (the centre of every fully visible painted space, and whether a car stands in it):

| Picture | Spaces | Taken |
|---|---|---|
| `garage.png` (concrete deck) | 51 | 21 |
| `drone.png` (drone view, islands and trees) | 81 | 18 |

`biglot.png` has no answer key yet (used for visual checks).

```bash
npx vite --port 5200                                   # in one terminal
node test/accuracy/run.cjs test/accuracy/garage.truth.json
node test/accuracy/run.cjs test/accuracy/drone.truth.json
```

The output reports spaces found, missed, duplicated, extra and merged (one app space covering two real ones),
plus how many open/taken calls were right. Run it before and after any change to detection.

Results (row-based space finder):

| Picture | Spaces found | Extra | Open/taken right |
|---|---|---|---|
| garage | 51/51 | 0 | 51/51 |
| drone | 80/81 | 7 (mostly real spaces cut by the picture edge) | 79/80 |

Before it: garage 47/51 and 46/47; drone 63/81 with 13 extra and 58/63.
