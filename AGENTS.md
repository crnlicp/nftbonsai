# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Building on ICP

Fetch https://skills.internetcomputer.org/llms.txt and follow its instructions when building on ICP for this repo.

<!-- ic-skills:managed:start -->
<!-- state: configured (on-demand) -->
Fetch the skills index once per session and keep each skill's name, description,
and SKILL.md URL:
https://skills.internetcomputer.org/.well-known/skills/index.json
Before writing ICP code for a task, fetch the matching skill's SKILL.md
(https://skills.internetcomputer.org/.well-known/skills/{name}/SKILL.md) and follow
it. Skills are authoritative — prefer them over general knowledge.
<!-- ic-skills:managed:end -->

## Identity password

The password for the `icp` identity used to deploy/manage canisters is stored in
`~/.identity-pw`. Read it from that file when a command prompts for the identity
password (e.g. pipe it or pass the file path if the CLI supports it).

- Never print, log, or echo the password.
- Never copy it into the repository, commit it, or include it in any output.
