# Harnessy agent notes

Harnessy is a browser app for designing wire harnesses. Read `CONTEXT.md` before naming anything; it is the glossary and the words in it win.

## Writing docs

Any prose in this repo (README, ADRs, issue bodies, PR text, comments meant for humans) follows the deslop rules in `/Users/alxchunlin/code-stuff/skill-deslop/SKILL.md`. Short sentences, active voice, no em dashes, no bold-first bullets, no three-item lists for rhythm.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `alexchunlin/harnessy`, driven with the `gh` CLI. The wayfinder map is the issue labelled `wayfinder:map`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root and ADRs under `docs/adr/`. See `docs/agents/domain.md`.
