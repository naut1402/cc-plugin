---
name: create-pr
description: Convention git và PR template — fallback khi project chưa có Rule git/PR; ưu tiên rule từ AGENTS.md qua project-rules.md.
user-invocable: false
---

# Create PR

Quy ước tạo branch, commit, và PR description. Mirror convention `agent-workflow` §6–§7.

## Rule từ project (ưu tiên)

Orchestrator đã truyền "Rule git/PR" vào `.dev-team-agent/project-rules.md`. Đọc phần đó trước: nếu có, convention project **ưu tiên hơn**. Nếu phần git-pr trống, dùng convention trong skill này làm fallback.

## Branch naming

```
<type>/<task-id>/<short-description>
```

Ví dụ:

- `docs/U00043/unify-doc-git-rules`
- `fix/B4488/null-pointer-order-detail`
- `feat/F003/export-csv-report`

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.

`short-description`: 3–5 từ tiếng Anh, kebab-case, mô tả thay đổi chính.

## Commit message format

```
[<task-id>] <type>: <subject>

<body — optional>
```

- `<type>`: `feat` / `fix` / `refactor` / `docs` / `test` / `chore`
- `<subject>`: mô tả ngắn, không quá 72 ký tự, không dấu chấm cuối
- Không footer `Refs:` / `Closes:` trong commit — liên kết issue đặt ở **PR body** (`Part of #n`)

Ví dụ:

```
[U00043] docs: unify doc and git rules with agent-workflow
```

**Không thêm AI trailer** vào commit message (không có `Co-Authored-By: …`, không footer công cụ).

## PR description template (`pr-desc.md`)

```markdown
## Issue

Part of #<issue-number>

## Summary

<1–3 bullet points mô tả thay đổi chính>

## Nội dung thay đổi

| Trước | Sau | Ghi chú |
|-------|-----|---------|
| path/to/file | path/to/file | Mô tả |

## Test plan

- [ ] TC-01: <tên test case / manual review>
- [ ] Regression: <chức năng liên quan>

## Notes for reviewer

<Điểm cần reviewer chú ý — từ review.md>
```

## Lưu ý

- `pr-creator` agent ghi `pr-desc.md` nhưng **không tự tạo PR** trên GitHub/GitLab.
- Orchestrator hoặc user sẽ tạo PR thủ công sau khi đọc và confirm `pr-desc.md`.
- PR title dùng cùng prefix với commit: `[<task-id>] <type>: <mô tả>`.
