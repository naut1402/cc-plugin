---
name: dev-team-orchestrator
description: Điều phối pipeline 6 agent (investigate→design→implement→review→PR) cho một dev task. Gọi khi user bắt đầu một task phát triển mới, cần chạy toàn bộ quy trình từ điều tra đến tạo PR. Dùng khi user đề cập task ID (B\d+, F\d+, U\d+), issue, hoặc yêu cầu bắt đầu implement một tính năng/fix bug.
argument-hint: "[task-id] [--resume] [--subtask-of=<parent-id>]"
user-invocable: true
---

# Dev Team Orchestrator

Skill điều phối toàn bộ pipeline phát triển. Đọc skill này, Claude Code gọi tuần tự 6 agent qua Task tool, duy trì trạng thái trong `.dev-state/<task-id>.json`, và chờ human approval tại các HITL checkpoint.

**Project rules nạp tập trung**: orchestrator gọi skill `read-project-rules` **một lần** ở đầu pipeline, ghi `project-rules.md`, rồi truyền phần rule tương ứng cho từng agent. Agent **không tự gọi** `read-project-rules` — chỉ đọc phần được chỉ định trong `project-rules.md`. Xem mục **Truyền rule cho agent**.

## Đầu vào

`$ARGUMENTS` = `<task-id> [--resume] [--subtask-of=<parent-id>] [--auto-review]`

- `<task-id>`: ID tác vụ (ví dụ `B4488`, `F003`, `U00281`). Bắt buộc.
- `--resume`: Tiếp tục từ phase đang dở (đọc `.dev-state/<task-id>.json`).
- `--subtask-of=<parent-id>`: Khai báo subtask — kế thừa `investigate.md` và `design.md` từ parent nếu subtask chưa có.
- `--auto-review`: Tự động chạy doc-reviewer sau HITL #1 và #2 mà không hỏi human. Phù hợp khi muốn chạy pipeline liên tục, ít tương tác.

## Cấu trúc thư mục task

```
tasks/
  <task-id>/
    project-rules.md       # rule project nạp một lần ở đầu pipeline
    investigate.md
    design.md
    investigate-po.md      # nếu doc-reviewer chạy cho investigate
    design-po.md           # nếu doc-reviewer chạy cho design
    phpstan.md
    review.md
    test-spec.md
    pr-desc.md
    qa.md                  # Q&A blocking questions (nếu có)
    <subtask-id>/          # workspace riêng cho subtask
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
  "auto_review": false,
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
- `auto_review`: có tự động chạy doc-reviewer không (từ flag `--auto-review`).
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
   - Nếu chưa có: tạo mới với `current_phase = "investigator"`, `auto_review = (--auto-review có mặt)`.
   - Nếu có `--resume`: đọc `current_phase` và tiếp tục từ đó. Nếu đồng thời có `--auto-review`, cập nhật `auto_review = true`.
3. Nếu có `--subtask-of=<parent-id>`: điền `parent_task_id` và `inherit_from_parent` (thường `["investigate.md", "design.md"]`).
4. **Nạp project rules (một lần cho cả pipeline)**: gọi skill `read-project-rules` (tất cả category), ghi kết quả vào `tasks/<task-id>/project-rules.md`.
   - Trên `--resume`: nếu `project-rules.md` đã tồn tại thì dùng lại, không gọi lại.
   - **Validate bắt buộc**: nếu category `doc-writing` nằm trong phần "Không tìm thấy" của kết quả → **dừng pipeline ngay**, báo user nơi đã tìm và lý do (investigator và designer bắt buộc cần format từ doc-writing rule, không có fallback). Các category còn lại (coding, test, git-pr) nếu thiếu thì agent tương ứng dùng fallback template.
   - Subtask kế thừa `project-rules.md` từ parent nếu chưa có (xem **Subtask inheritance**).

## Truyền rule cho agent

Mỗi khi spawn agent, orchestrator chỉ định phần rule liên quan trong `project-rules.md` để agent áp dụng. Agent **đọc** phần được chỉ định, **không tự gọi** `read-project-rules`.

| Agent | Phần rule áp dụng | Khi phần đó trống |
|---|---|---|
| investigator | Rule viết tài liệu (doc-writing) | **Dừng** — bắt buộc |
| designer | Rule viết tài liệu (doc-writing) | **Dừng** — bắt buộc |
| implementer | Rule coding | Fallback template `coding-rules` |
| reviewer | Rule coding + Rule test | Fallback `coding-rules` / `write-tests` |
| pr-creator | Rule git/PR | Fallback `create-pr` |
| doc-reviewer | Rule review doc | **Dừng** — bắt buộc |

Các category bắt buộc (`doc-writing`) đã được validate ở Khởi tạo nên investigator/designer luôn có rule khi chạy. Category `doc-review` được validate tại gate HITL-doc (chỉ chạy khi user opt-in).

### Bước 1 — investigator

Cập nhật state: `current_phase = "investigator"`.

Spawn `dev-agent-teams:investigator` qua Task tool:
```
Task: investigator <task-id>
  → áp dụng "Rule viết tài liệu" trong tasks/<task-id>/project-rules.md (bắt buộc)
```

Agent ghi `tasks/<task-id>/investigate.md`. Nếu agent tạo `qa.md` → **Q&A HITL** (xem bên dưới).

### HITL #1 — Duyệt investigate.md

Khi investigator hoàn tất: cập nhật `hitl_pending = "hitl-1"`.

**Nếu `auto_review = true`**: tự động spawn `doc-reviewer` → **HITL-doc (investigate)**, không hỏi human.

**Nếu `auto_review = false`**: thông báo user:
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
  → áp dụng "Rule viết tài liệu" trong tasks/<task-id>/project-rules.md (bắt buộc)
```

Agent đọc `investigate.md` và `knowhow`, ghi `design.md`. Nếu tạo `qa.md` → **Q&A HITL**.

### HITL #2 — Duyệt design.md

**Nếu `auto_review = true`**: tự động spawn `doc-reviewer` → **HITL-doc (design)**, không hỏi human.

**Nếu `auto_review = false`**: tương tự HITL #1. Thông báo user đọc `design.md`, hỏi doc-review.

- approved + yes: spawn `doc-reviewer` → **HITL-doc (design)**.
- approved + no: chuyển Bước 3.

### Bước 3 — implementer

Cập nhật state: `current_phase = "implementer"`, `hitl_pending = null`.

Spawn `dev-agent-teams:implementer`:
```
Task: implementer <task-id>
  → áp dụng "Rule coding" trong tasks/<task-id>/project-rules.md (fallback coding-rules nếu trống)
```

Agent chạy 2 phase nội tại (code + phpstan), commit thay đổi và ghi `phpstan.md`. Nếu tạo `qa.md` → **Q&A HITL**.

### Bước 4 — reviewer

Cập nhật state: `current_phase = "reviewer"`.

Spawn `dev-agent-teams:reviewer`:
```
Task: reviewer <task-id>
  → áp dụng "Rule coding" + "Rule test" trong tasks/<task-id>/project-rules.md (fallback nếu trống)
```

Agent ghi `review.md` và `test-spec.md`.

### HITL #3 — Duyệt review.md (bắt buộc)

Cập nhật `hitl_pending = "hitl-3"`.

Thông báo user đọc `review.md` và `git diff` commit implement. Checkpoint bắt buộc vì pr-creator amend commit và sau đó user sẽ push.

- Nếu có [must]: `review_round++` (max 2) → gọi lại implementer → reviewer → HITL #3.
- Nếu `review_round >= 2` và vẫn còn [must]: thông báo user, dừng — cần can thiệp thủ công.
- Nếu approved: chuyển Bước 5.

### Bước 5 — pr-creator

Cập nhật state: `current_phase = "pr-creator"`, `hitl_pending = null`.

Spawn `dev-agent-teams:pr-creator`:
```
Task: pr-creator <task-id>
  → áp dụng "Rule git/PR" trong tasks/<task-id>/project-rules.md (fallback create-pr nếu trống)
```

Agent ghi `pr-desc.md`. Orchestrator thông báo hoàn tất và đường dẫn `pr-desc.md`.

---

## HITL-doc (conditional)

Chỉ chạy khi user chọn yes tại gate sau HITL #1 hoặc #2.

Cập nhật `hitl_pending = "hitl-doc"`, `doc_review_round.<doc>++`.

**Validate trước khi chạy**: nếu category `doc-review` nằm trong "Không tìm thấy" của `project-rules.md` → báo user là không có rule review hợp lệ, **bỏ qua doc-reviewer** và tiếp tục pipeline (doc-review bắt buộc cần rule, không có thì không review được).

Spawn `dev-agent-teams:doc-reviewer`:
```
Task: doc-reviewer <task-id> --doc=<investigate|design>
  → áp dụng "Rule review doc" trong tasks/<task-id>/project-rules.md (bắt buộc)
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
- `project-rules.md`: nếu subtask chưa có, copy từ `tasks/<parent-id>/project-rules.md` (rule project không đổi giữa parent và subtask). Nếu parent cũng chưa có, nạp mới như Khởi tạo bước 4.
- Trước khi spawn investigator: kiểm tra `tasks/<task-id>/investigate.md`.
  - Nếu chưa có và `"investigate.md"` trong `inherit_from_parent`: copy từ `tasks/<parent-id>/investigate.md` hoặc truyền path cho agent đọc.
- Tương tự với `design.md`.
- Subtask workspace: `tasks/<task-id>/` — không ghi vào thư mục của parent.
