---
name: archive
description: Snapshot this SilverBullet plugin (and the user's personal SilverBullet skill, if any) as a zip into the day's journal with a description block. Run only when the user invokes it.
user-invocable: true
disable-model-invocation: true
argument-hint: "[what changed]"
---

# Archive the SilverBullet skills into the journal

1. **Collect** into an empty temp folder `silverbullet/`:
   - `${CLAUDE_PLUGIN_ROOT}` contents **without** `config.json`
   - the user's personal SilverBullet skill folder, if one exists (e.g. `~/.claude/skills/silverbullet-personal/`), again without credentials
2. **Zip** with forward-slash paths: Windows `tar.exe -a -c -f <out>.zip -C <temp> silverbullet` (not `Compress-Archive` — it writes `\`), elsewhere `zip -r`. List the archive to check, and grep it for the token before uploading.
3. **Upload** to `<journalFolder>/silverbullet-skill_DD-MM-YYYY.zip` (`upload`); same day → overwrite.
4. **Describe** with `log skill-silverbullet-<YYYY-MM-DD> "<one-line summary>" --detail entry.md` (see silverbullet:journal). Entry: link `[[<journalFolder>/<zip>]]`, size (from `ls --all`), what the zip contains and how to install it, what changed vs the previous zip (link it), "no token inside".
5. Report the block's changed lines.
