# Accuracy checks

`garage.truth.json` marks the centre of every painted space in `garage.png` (51 spaces) and whether a car
stands in it (21 taken). The other pictures have no hand labels; their check reports totals and overlapping
spaces only.

```bash
npx vite --port 5200                                   # in one terminal
node test/accuracy/run.cjs test/accuracy/garage.truth.json
```

The output reports spaces found, missed, duplicated and extra, plus how many open/taken calls were right.
Run it before and after a change to the detection to catch regressions.

Results at the time of writing (garage.png): 47/51 spaces found, 0 duplicates, 0 extra, 46/47 open/taken
correct (610 is shown taken but is empty).
