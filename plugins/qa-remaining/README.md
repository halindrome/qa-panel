# qa-remaining

A Claude Code side pane that lists the tickets still open for the branch your work merges
into: an epic, a release branch, trunk. Claude keeps the list current as tickets move. You
set the order they get worked in.

```
Payments epic
12 tickets · updated 2026-10-26 · press ≡ to reorder

Needs a code fix (2)
≡ PROJ-101 Survey harness hardcodes test records
≡ PROJ-107 Check what is left after PROJ-124, then close or split

Fix merged, retest after the next build (3)
≡ PROJ-113 API fix merged; bench retest needs the new build
...
```

## Install

```bash
claude plugin marketplace add halindrome/qa-panel
claude plugin install qa-remaining@halindrome
```

Restart Claude Code, then run `/qa-remaining`. It opens the pane and tells you which merge target
it picked and where that target's list lives.

## Where the list lives

One JSON file per merge target, inside the repo:

```
<repo root>/.claude/remaining/<target>.json      # "/" in the branch name becomes "__"
```

In a monorepo with submodules the root is the superproject, so every submodule shares one
list. Commit the folder if the team should share the list, or gitignore it to keep the list private.

Ask Claude to start it ("start a remaining list for this epic from JIRA"). Once the file exists,
the plugin tells Claude where it is and what shape it has in every session, so Claude keeps it current.

## How the merge target is picked

The first rule that applies wins:

1. `git config qa-remaining.target <branch>`, a per-repo override that commits nothing.
2. A `.branchconfig.yaml` at the repo root, if you use one. A `feature` or `hotfix` branch
   uses its `base_branch`. An `epic`, `release` or `trunk` branch is its own target.
   ```yaml
   branch_type: feature
   base_branch: epic/payments    # this work merges into the epic
   ```
3. The current branch. Working on the epic branch directly shows the epic's list.

## The file

```json
{
  "title": "Payments epic",
  "updated": "2026-10-26",
  "ticketUrl": "https://example.atlassian.net/browse/",
  "search": { "label": "Live search: open children", "href": "https://example.atlassian.net/issues/?jql=..." },
  "groups": [
    { "name": "Needs a code fix", "items": [{ "key": "PROJ-101", "why": "Harness hardcodes test records" }] },
    { "name": "Ready for QA", "items": [{ "key": "PROJ-113", "why": "Merged; retest on the next build" }] }
  ],
  "todo": ["Ask the PM about PROJ-120's scope"]
}
```

Every field is optional except `groups`. A ticket links to `ticketUrl` + `key`, or to its own `href`, so any
tracker works (Jira, GitHub issues, Linear). Order in an array is priority.

## Reordering

Click (or Tab to it and press Enter):

- `≡` beside a row picks it up. It turns into `↕`.
- `›` beside another row drops the picked row in front of that row.
- A group header (`← drop at end`) drops it at the end of that group, so a ticket can change group.
- `↕` again cancels.

The new order is written straight to the JSON file. Tickets can move between groups; to-dos
stay in the to-do list.
