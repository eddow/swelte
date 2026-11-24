# Accepted shell test evidence

Dated directories preserve reviewed acceptance runs, including runtime revisions,
measurements and final answers. These are historical results, not test fixtures
or inputs. The 2026-11-24 snapshots support the shell usability acceptance record.

Test runs write disposable results to `examples/shell/test-results/` (git-ignored).
Review a new run before manually promoting its JSON into a new dated directory;
do not overwrite accepted snapshots. `SHELL_LIVE_EVIDENCE` can override the live
matrix output path.
