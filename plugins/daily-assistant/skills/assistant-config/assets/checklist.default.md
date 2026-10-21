# End-of-day checklist

<!--
Format: one item per line.
  - [ ] <label> :: <action>
<action> is a skill call (`/daily-assistant:<skill> args`, plugin-qualified) or `manual` (ask the user to confirm).
Items run top to bottom. Copy this file, edit it, and point `checklist:` in the config to it.
-->

- [ ] Commit or stash today's work in progress :: manual
- [ ] Logwork for today is complete :: /daily-assistant:check-logwork --today
- [ ] Task status / progress in tracker is up to date :: /daily-assistant:my-tasks --review
- [ ] Daily report sent :: /daily-assistant:daily-report
- [ ] Inbox folders swept into the task archive :: /daily-assistant:tidy-workspace --scope=files
- [ ] Merged branches and stale worktrees cleaned :: /daily-assistant:tidy-workspace --scope=git
- [ ] Activity of the day written into the journal :: /daily-assistant:watch flush
- [ ] Todo reviewed and tomorrow's items scheduled :: /daily-assistant:todo review
- [ ] Approve what the assistant learned today :: /daily-assistant:learn review
- [ ] Capabilities and learnings of the day recorded, profile page updated :: /daily-assistant:evolution review
