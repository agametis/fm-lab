<!-- template: fm-changes/1 — headings are written in English and rendered in the report language; fill every {{placeholder}}, remove every instruction comment; FileMaker identifiers stay original -->
# Changes in {{solution}}: {{window_label}}

{{generated_at}} · fm-lab {{fmlab_version}} · fm-changes {{skill_version}} · data state {{data_state}}{{scope_note}}

## Summary

<!-- Release notes in prose, 1–3 paragraphs, no lists: what was worked on (files, modules),
what is new, what changed most, who worked on it, notable patterns (one long session, a
migration or paste as mass event). Facts only from the result sets; mark interpretation
("presumably"). Name a closed window's limit here when objects may be missing. -->

## At a glance

| | |
|---|---|
| Changed objects (individual changes) | {{changed_objects}} |
| New objects (counter 0–1) | {{new_objects}} |
| Persons | {{persons}} |
| Files | {{files}} |
| Work sessions | {{sessions}} |
| Mass events in the window | {{mass_events}} ({{objects_in_mass_events}} objects, not listed below) |

## Changes by file and module

<!-- One "### <File>" per file, most changes first; inside, one "#### <module>" per module
(column `module` of #3/#4 — a remaining file prefix means the module is centred in that file;
without partition or community: "#### Without module").
Detail-tier objects (C3): "- **<Type> <Name>** — <one sentence> (<date>, <person>, <saves>
saves, new)". List-tier objects: "- <Type> <Name> — <info/note if any> (<date>)". More than
25 objects in one module: group by type with counts and name the ten most saved. Objects
beyond the row cap: say how many are missing and how to narrow (--file, --person, window). -->

## Mass events

<!-- Table: Start · End · Kind (mass action / paste or import / tool run) · Scope (file /
solution) · Objects in the window · Types. Then one sentence: their objects are not listed
individually, the stamp says little about the single object. "None in this window." when
empty. -->

## Work sessions

<!-- Table: Start · End · Person · Objects · Files — newest first, at most 20 rows (say how
many more). -->

## Data basis and limits

<!-- Adapt, keep short:
- Each object keeps only its last change stamp. With an open end ("since <date>") the list is
  exactly what changed since then; with a closed window, objects changed again after its end
  are missing. A session report shows the objects whose last change falls into the session.
- Mass events overwrite stamps: an object changed in the window and stamped by a later mass
  event shows up there, not here. Deleted objects leave no trace.
- Persons are user names folded to lower case; spelling variants of one person stay
  separate (the web frontend merges them through curated aliases).
- Times are the local time of the editing client. Parameters: {{parameters}}. -->
