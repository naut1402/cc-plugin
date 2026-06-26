---
name: verify-dashboard
description: Chạy build và Playwright verify cho dev-dashboard viewer. Reference skill — dùng bởi implementer agent (cc-plugin).
user-invocable: false
---

# Verify Dashboard

Quy trình xác minh thay cho PHPStan trên repo cc-plugin.

## Thư mục viewer

`plugins/dev-agent-teams/skills/dev-dashboard/assets/viewer/`

## Bước thực hiện

1. `npm run build` trong thư mục viewer — phải exit 0.
2. `node scripts/verify-runners.mjs` — Playwright verify Runner Config (nếu server chưa chạy, script có thể skip UI tests và chỉ test API module).
3. Ghi kết quả vào `.dev-team-agent/tasks/<task-id>/verify.md`:

```markdown
# Verify — <task-id>

## Build
- Command: npm run build
- Result: pass/fail
- Output: (tóm tắt lỗi nếu có)

## verify-runners.mjs
- Result: pass/fail
- Details: (từ verify-results.json)
```
