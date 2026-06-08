---
name: dev-team-orchestrator
description: Điều phối pipeline 6 agent (investigate→design→implement→review→PR) cho một dev task. Gọi khi user bắt đầu một task phát triển mới, cần chạy toàn bộ quy trình từ điều tra đến tạo PR. Dùng khi user đề cập task ID (B\d+, F\d+, U\d+), issue, hoặc yêu cầu bắt đầu implement một tính năng/fix bug.
argument-hint: "[task-id] [--resume] [--subtask-of=<parent-id>]"
user-invocable: true
---

# Dev Team Orchestrator

Skill điều phối toàn bộ pipeline phát triển. Đọc skill này, Claude Code gọi tuần tự 6 agent qua Task tool, duy trì trạng thái trong `.dev-state/<task-id>.json`, và chờ human approval tại các HITL checkpoint.

## Đầu vào

`$ARGUMENTS` = `<task-id> [--resume] [--subtask-of=<parent-id>]`

- `<task-id>`: ID tác vụ (ví dụ `B4488`, `F003`, `U00281`). Bắt buộc.
- `--resume`: Tiếp tục từ phase đang dở (đọc `.dev-state/<task-id>.json`).
- `--subtask-of=<parent-id>`: Khai báo subtask — kế thừa `investigate.md` và `design.md` từ parent nếu subtask chưa có.

## Cấu trúc thư mục task

```
tasks/
  <task-id>/
    investigate.md
    design.md
    investigate-po.md      # nếu doc-reviewer chạy cho investigate
    design-po.md           # nếu doc-reviewer chạy cho design
    patches/               # code patches từ implementer
    phpstan.md
    review.md
    test-spec.md
    pr-desc.md
    qa.md                  # Q&A blocking questions (nếu có)
    <subtask-id>/          # workspace riêng cho subtask
      patches/
      review.md
      ...
```

## State file: `.dev-state/<task-id>.json`

```json
{
  "task_id": "B4488",
  "parent_task_id": null,
  "current_phase": "investigator",
  "hitl_pending": null,
  "review_round": 0,
  "doc_review_round": {
    "investigate": 0,
    "design": 0
  },
  "inherit_from_parent": []
}
```

- `current_phase`: agent đang chạy — dùng để resume sau Q&A HITL.
- `hitl_pending`: checkpoint nào đang chờ duyệt (`"hitl-1"`, `"hitl-2"`, `"hitl-3"`, `"hitl-doc"`).
- `review_round`: số vòng implementer được gọi lại sau HITL #3 (max 2).
- `doc_review_round`: số vòng doc-reviewer đã chạy cho từng tài liệu.
- `inherit_from_parent`: danh sách artifact kế thừa từ parent task (subtask only).

Chỉ orchestrator đọc và ghi file này. Không encode "phase X đã xong" — status suy ra từ sự tồn tại và tính hợp lệ của artifact.

## File Q&A: `tasks/<task-id>/qa.md`

Agent ghi câu hỏi blocking vào đây khi gặp ambiguity cần human quyết định. Orchestrator phát hiện file này được tạo mới → dừng pipeline → thông báo user → chờ user trả lời và confirm.

Format:
```markdown
# Q&A — <task-id>

## Q1: <câu hỏi ngắn gọn>
**Context**: <tại sao cần hỏi>
**Options**: (nếu có)
- A: ...
- B: ...
**Answer**: ← user điền vào đây
```

## Workflow

### Khởi tạo

1. Tạo thư mục `tasks/<task-id>/` nếu chưa có.
2. Đọc `.dev-state/<task-id>.json`:
   - Nếu chưa có: tạo mới với `current_phase = "investigator"`.
   - Nếu có `--resume`: đọc `current_phase` và tiếp tục từ đó.
3. Nếu có `--subtask-of=<parent-id>`: điền `parent_task_id` và `inherit_from_parent` (thường `["investigate.md", "design.md"]`).

### Bước 1 — investigator

Cập nhật state: `current_phase = "investigator"`.

Spawn `dev-agent-teams:investigator` qua Task tool:
```
Task: investigator <task-id>
```

Agent ghi `tasks/<task-id>/investigate.md`. Nếu agent tạo `qa.md` → **Q&A HITL** (xem bên dưới).

### HITL #1 — Duyệt investigate.md

Khi investigator hoàn tất: cập nhật `hitl_pending = "hitl-1"`.

Thông báo user:
```
✅ Investigator xong. Vui lòng đọc tasks/<task-id>/investigate.md và xác nhận.
Sau khi duyệt, gõ "approved" (hoặc feedback cần sửa).
Có muốn chạy doc-reviewer cho investigate.md không? (yes/no)
```

- Nếu user feedback cần sửa: gọi lại investigator, lặp HITL #1.
- Nếu approved + yes doc-review: spawn `doc-reviewer` → **HITL-doc (investigate)**.
- Nếu approved + no: chuyển Bước 2.

### Bước 2 — designer

Cập nhật state: `current_phase = "designer"`, `hitl_pending = null`.

Spawn `dev-agent-teams:designer`:
```
Task: designer <task-id>
```

Agent đọc `investigate.md` và `knowhow`, ghi `design.md`. Nếu tạo `qa.md` → **Q&A HITL**.

### HITL #2 — Duyệt design.md

Tương tự HITL #1. Thông báo user đọc `design.md`, hỏi doc-review.

- approved + yes: spawn `doc-reviewer` → **HITL-doc (design)**.
- approved + no: chuyển Bước 3.

### Bước 3 — implementer

Cập nhật state: `current_phase = "implementer"`, `hitl_pending = null`.

Spawn `dev-agent-teams:implementer`:
```
Task: implementer <task-id>
```

Agent chạy 2 phase nội tại (code + phpstan), ghi `patches/` và `phpstan.md`. Nếu tạo `qa.md` → **Q&A HITL**.

### Bước 4 — reviewer

Cập nhật state: `current_phase = "reviewer"`.

Spawn `dev-agent-teams:reviewer`:
```
Task: reviewer <task-id>
```

Agent ghi `review.md` và `test-spec.md`.

### HITL #3 — Duyệt review.md (bắt buộc)

Cập nhật `hitl_pending = "hitl-3"`.

Thông báo user đọc `review.md` và `patches/`. Checkpoint bắt buộc vì pr-creator tác động ra hệ thống ngoài.

- Nếu có [must]: `review_round++` (max 2) → gọi lại implementer → reviewer → HITL #3.
- Nếu `review_round >= 2` và vẫn còn [must]: thông báo user, dừng — cần can thiệp thủ công.
- Nếu approved: chuyển Bước 5.

### Bước 5 — pr-creator

Cập nhật state: `current_phase = "pr-creator"`, `hitl_pending = null`.

Spawn `dev-agent-teams:pr-creator`:
```
Task: pr-creator <task-id>
```

Agent ghi `pr-desc.md`. Orchestrator thông báo hoàn tất và đường dẫn `pr-desc.md`.

---

## HITL-doc (conditional)

Chỉ chạy khi user chọn yes tại gate sau HITL #1 hoặc #2.

Cập nhật `hitl_pending = "hitl-doc"`, `doc_review_round.<doc>++`.

Spawn `dev-agent-teams:doc-reviewer`:
```
Task: doc-reviewer <task-id> --doc=<investigate|design>
```

Agent ghi `{doc}-po.md`. Thông báo user đọc file PO:
- Không có PO: tiếp tục pipeline.
- Có PO: gọi lại agent nguồn (investigator hoặc designer) để sửa → doc-reviewer lại.

---

## Q&A HITL (inline)

Xảy ra bất kỳ lúc nào investigator / designer / implementer tạo `qa.md`.

1. Orchestrator phát hiện `qa.md` được tạo/cập nhật → dừng pipeline.
2. Thông báo: `⚠️ Agent có câu hỏi blocking. Vui lòng đọc tasks/<task-id>/qa.md, trả lời và gõ "done".`
3. Sau khi user confirm: đọc `current_phase` từ state → spawn lại đúng agent để tiếp tục.

---

## Subtask inheritance

Khi `parent_task_id` được set:
- Trước khi spawn investigator: kiểm tra `tasks/<task-id>/investigate.md`.
  - Nếu chưa có và `"investigate.md"` trong `inherit_from_parent`: copy từ `tasks/<parent-id>/investigate.md` hoặc truyền path cho agent đọc.
- Tương tự với `design.md`.
- Subtask workspace: `tasks/<task-id>/` — không ghi vào thư mục của parent.
