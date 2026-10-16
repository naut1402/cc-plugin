# End-of-day checklist

<!--
Format: one item per line.
  - [ ] <label> :: <action>
<action> is a skill call (`/skill args`) or `manual` (ask the user to confirm).
Items run top to bottom. Copy this file, edit it, and point `checklist:` in the config to it.
-->

- [ ] Commit or stash today's work in progress :: manual
- [ ] Logwork for today is complete :: /check-logwork --today
- [ ] Task status / progress in tracker is up to date :: /my-tasks --review
- [ ] Daily report sent :: /daily-report
- [ ] Inbox folders swept into the task archive :: /tidy-workspace --scope=files
- [ ] Merged branches and stale worktrees cleaned :: /tidy-workspace --scope=git
- [ ] Activity of the day written into the journal :: /watch flush
- [ ] Todo reviewed and tomorrow's items scheduled :: /todo review
- [ ] Approve what the assistant learned today :: /learn review
