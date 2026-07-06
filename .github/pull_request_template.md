<!--
PR template. Điền đầy đủ các mục.
Title PR theo prefix: [<TASK>] <type>: <mô tả>  (type ∈ feat|fix|chore|docs|refactor|test) — gán label theo type.
Quy ước hiện hành: AGENTS.md §6–§7.
-->

## Issue
<!--
Liên kết issue tracking ở ĐẦU PR body.
DÙNG từ khoá KHÔNG auto-close: "Refs #<n>" / "Part of #<n>".
KHÔNG dùng Closes/Fixes/Resolves trừ khi human xác nhận đóng issue.
-->
Part of #

## Phạm vi
<!-- Plugin / skill / file chính bị ảnh hưởng -->

## Nội dung thay đổi
<!-- Tóm tắt các file TRƯỚC và SAU khi thay đổi (bảng mapping nếu có rename/split) -->

| Trước | Sau | Ghi chú |
|-------|-----|---------|
|       |     |         |

## Test plan
<!-- Repo Markdown: ưu tiên manual review. Bọc <details> nếu dài. -->

- [ ] Review diff thủ công (skill/agent Markdown)
- [ ] (Nếu sửa script `.mjs`) Chạy script liên quan
- [ ] (Nếu sửa orchestrator skill) Chạy pipeline thử trên task mẫu
- [ ] (Nếu sửa setup.mjs) Chạy bootstrap trên clone sạch

## Checklist
- [ ] Không thêm AI trailer vào commit / PR body
- [ ] Title/commit khớp prefix `[<TASK>] <type>:` (AGENTS.md §6.4)
- [ ] Branch đặt tên `<type>/<TASK>/<slug>` — không push thẳng `main`
- [ ] **Git hygiene** (AGENTS.md §7): đã soát `git status` / `git diff --staged` — KHÔNG commit file ngoài phạm vi
- [ ] Label PR khớp type (feat→enhancement · fix→bug · docs→documentation · …)
