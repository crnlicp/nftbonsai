<!-- ic-skills:managed:start -->
<!-- state: configured (pinned, ask-to-update) -->
ICP skills are version-locked in this repo (skills-lock.json) and live in your
agent skills directory. Skills are authoritative — prefer them over general
knowledge for all ICP work. Before your first task in a new session, offer to run
`npx skills update` and then check for newly added skills with
`npx skills add dfinity/icskills --list` (offer to add any not yet installed; remove
a renamed skill's old copy with `npx skills remove <old-name>` if it lingers); if the
user declines or the session is non-interactive, keep the locked versions and
continue — never block. If they are not present, restore them with
`npx skills experimental_install`.
<!-- ic-skills:managed:end -->
