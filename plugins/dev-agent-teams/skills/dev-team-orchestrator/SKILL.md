---
name: dev-team-orchestrator
description: điều phối pipeline phát triển phần mềm theo cấu hình động pipeline.yaml cho một dev task end-to-end, mặc định investigate → design → implement → review → pr. dùng khi user bắt đầu hoặc tiếp tục task có mã như B4488, F003, U00281, nhắc đến issue/bug/feature, yêu cầu implement/fix/review/tạo PR, hoặc muốn resume/subtask/auto-review/export-json. skill quản lý state, artifact, human approval, q&a blocking, rule loading, retry vòng review và mô tả PR trong .dev-team-agent.
argument-hint: "[task-id] [--resume] [--subtask-of=<parent-id>] [--auto-review] [--export-json]"
user-invocable: true
---

# Dev Team Orchestrator

Điều phối một dev task theo pipeline khai báo trong `pipeline.yaml`. Luôn chạy theo config, không hardcode thứ tự phase, agent, artifact, rule category, HITL gate, hay retry rule.

## Supported invocation

Nhận `$ARGUMENTS` theo dạng:

```text
<task-id> [--resume] [--subtask-of=<parent-id>] [--auto-review] [--export-json]
```

- Bắt buộc có `<task-id>`; chấp nhận các dạng phổ biến như `B4488`, `F003`, `U00281`.
- `--resume`: đọc state hiện có và chạy tiếp từ `current_phase` hoặc gate đang pending.
- `--subtask-of=<parent-id>`: tạo workspace subtask, kế thừa artifact nền từ parent khi còn thiếu.
- `--auto-review`: tự chạy doc-reviewer ở các gate `optional_doc_review` không blocking.
- `--export-json`: sau mỗi phase, merge structured summary vào `pipeline-export.json`.

Nếu thiếu `<task-id>`, dừng và hỏi lại task id. Không tự đặt task id.

## Canonical workspace

Chỉ đọc/ghi dưới root thống nhất `.dev-team-agent/` ở repository root:

```text
.dev-team-agent/
  pipeline.yaml
  project-rules.md
  .dev-state/<task-id>.json
  tasks/<task-id>/
    pipeline.yaml
    investigate.md
    design.md
    investigate-po.md
    design-po.md
    phpstan.md
    review.md
    test-spec.md
    pr-desc.md
    qa.md
    pipeline-export.json
```

Artifact thực tế phụ thuộc `steps[].produces` trong config. Không suy luận phase hoàn tất từ tên phase; suy luận từ artifact được khai báo và tính hợp lệ tối thiểu của nội dung.

## Load and merge pipeline config

Luôn nạp config theo thứ tự sau:

1. Built-in default: `assets/pipeline.default.yaml` trong skill này.
2. Global override: `.dev-team-agent/pipeline.yaml` nếu tồn tại.
3. Per-task override: `.dev-team-agent/tasks/<task-id>/pipeline.yaml` nếu tồn tại.

Merge rules:

- Global config có `steps` thì thay toàn bộ danh sách built-in `steps`.
- Per-task config patch theo `step.id` trên danh sách hiện hành.
- Với per-task patch: step trùng `id` thì merge field; `hitl` merge một cấp; `id` mới thêm vào cuối; `remove: true` xoá step.
- `defaults` và `doc_reviewer` merge theo từng key ở cả global và per-task.
- Nếu không có override, dùng nguyên `assets/pipeline.default.yaml`.

Khi đọc YAML, ưu tiên parser nếu môi trường có sẵn. Nếu không có parser, đọc như tài liệu cấu trúc và vẫn phải tôn trọng schema trong `assets/pipeline.default.yaml`.

## State contract

State file: `.dev-team-agent/.dev-state/<task-id>.json`.

Tạo mới khi chưa có:

```json
{
  "task_id": "<task-id>",
  "parent_task_id": null,
  "current_phase": "<first step.id>",
  "hitl_pending": null,
  "review_round": 0,
  "auto_review": false,
  "export_json": false,
  "doc_review_round": {},
  "inherit_from_parent": []
}
```

Rules:

- Chỉ orchestrator cập nhật state.
- `current_phase` luôn là `steps[].id`, không phải tên agent cứng.
- `hitl_pending` là `null`, một `gate_id`, `"hitl-doc"`, hoặc `"qa"` (khi đang chờ trả lời Q&A blocking).
- Khi có `--resume`, không reset phase; chỉ cập nhật `auto_review/export_json` nếu flag được truyền.
- Ghi state trước khi spawn agent và sau mỗi gate để resume an toàn.

## Project rules loading

Ở đầu pipeline, gọi skill `read-project-rules` một lần để lấy toàn bộ rule project và ghi vào `.dev-team-agent/project-rules.md`.

Trên `--resume`, nếu file này đã tồn tại thì dùng lại. Không yêu cầu agent con tự gọi `read-project-rules`.

Validate trước khi chạy step:

- Với mỗi `step.rule_required: true`, nếu mọi `rule_category` của step nằm trong phần không tìm thấy hoặc trống, dừng pipeline và báo rõ step, category thiếu, đường dẫn đã kiểm tra.
- Với `rule_required: false`, cho phép tiếp tục; prompt agent dùng `rule_fallback_skill` nếu section tương ứng trống.
- Với `doc_reviewer.rule_required: true`, nếu rule review thiếu thì bỏ qua doc-reviewer có giải thích, không chặn toàn bộ pipeline trừ khi config yêu cầu blocking riêng.

## Execution loop

Duyệt `steps` theo thứ tự config, bắt đầu từ `current_phase`.

Với mỗi step:

1. Cập nhật state: `current_phase = step.id`, `hitl_pending = null`.
2. **Thực thi agent qua Runner** (ưu tiên) hoặc Task tool (fallback):
   - Ghi prompt theo template (mục Agent prompt template) vào `.dev-team-agent/tasks/<task-id>/.prompt-<step-id>.txt`.
   - Runner CLI nằm trong app dashboard (repo tách riêng [naut1402/agent-workflow](https://github.com/naut1402/agent-workflow)), clone ở `$DEV_TEAM_DASHBOARD_APP` (mặc định `~/.dev-team-dashboard/app`). Chạy `/dev-dashboard` một lần để clone nếu chưa có. Dùng `bun` (runner import nguồn `.ts`):

```bash
bun "${DEV_TEAM_DASHBOARD_APP:-~/.dev-team-dashboard/app}/server/runner-cli.mjs" submit \
  --task-id <task-id> \
  --step-id <step.id> \
  --agent <step.agent> \
  --workspace .dev-team-agent/tasks/<task-id> \
  --project-root <repo-root> \
  --dev-team-root .dev-team-agent \
  --prompt-file .dev-team-agent/tasks/<task-id>/.prompt-<step-id>.txt \
  --produces <comma-separated step.produces> \
  --wait
```

   - Runner đọc default runner từ `~/.dev-team-dashboard/runners.json`, enqueue job, gọi `RunnerProvider` (`claude-code-cli`).
   - Nếu job `failed` và lỗi là runner disabled / CLI không tìm thấy → **fallback** spawn `step.agent` qua Task tool với cùng prompt.
   - Prompt phải chứa: task id, parent id nếu có, `step.skills`, `rule_category`, `rule_required`, fallback rule, artifact `step.produces`, **`knowledge_inputs`** (nếu có), `export_json`, artifact context hiện có.
3. Sau khi agent kết thúc, kiểm tra `qa.md`. Nếu file mới hoặc thay đổi, chuyển sang Q&A HITL.
4. Kiểm tra `step.produces` artifacts tồn tại và hợp lệ tối thiểu.
5. Nếu `export_json = true`, merge structured summary vào `pipeline-export.json` dưới `phases[step.export_key]`.
6. Xử lý `step.hitl` theo section bên dưới.
7. Chuyển sang step kế tiếp khi gate cho phép.

Không bỏ qua step chỉ vì tên step quen thuộc. Chỉ bỏ qua khi config hoặc subtask inheritance cho phép rõ ràng.

## Agent prompt template

Dùng template này khi spawn từng agent:

```text
Task: <step.agent> <task-id>

Context:
- Workspace: .dev-team-agent/tasks/<task-id>/
- State: .dev-team-agent/.dev-state/<task-id>.json
- Project rules: .dev-team-agent/project-rules.md
- Pipeline step id: <step.id>
- Step name: <step.name>
- Required artifacts: <step.produces>
- Export JSON: <true|false>
- Knowledge inputs: <step.knowledge_inputs or "none">

Instructions:
- Apply skills: <step.skills>
- If `knowledge_inputs` is non-empty: read each entry from `.dev-team-agent/knowledge/<id>.md` (id format `project/slug` or `system/slug`), inject a `## Knowledge inputs` section into the prompt with title + full markdown body per entry. Skip missing entries with a note.
- Apply project-rules section(s): <step.rule_category>
- If rule_required=true, treat missing rules as already validated by orchestrator.
- If rule_required=false and section is missing/empty, apply fallback skill: <step.rule_fallback_skill>.
- Write only the artifacts declared for this step unless a blocking question requires qa.md.
- If blocked by ambiguity, write qa.md using the Q&A format and stop.
- If Export JSON is true, return a concise structured summary for export_key=<step.export_key>.
```

## HITL gates

Supported `hitl.mode`:

- `none`: không có gate; chuyển step kế.
- `auto`: tự duyệt; nếu có `optional_doc_review` và `auto_review=true`, chạy HITL-doc trước khi chuyển step kế.
- `manual`: cập nhật `hitl_pending = gate_id`, rồi chờ human trừ khi đủ điều kiện auto doc-review không blocking.

Manual gate message:

```text
✅ <step.name> xong. Vui lòng đọc <produces> và xác nhận.
Gõ "approved" để tiếp tục, hoặc gửi feedback cần sửa.
<nếu optional_doc_review=true> Bạn có muốn chạy doc-reviewer không? (yes/no)
```

Nếu user gửi feedback cần sửa, gọi lại cùng `step.agent` với feedback và lặp gate.

Nếu `blocking: true`, luôn cần human approval dù `--auto-review` bật.

## Retry handling

Nếu `step.hitl.retry` tồn tại, chỉ áp dụng sau gate của step đó.

- Khi artifact hoặc human feedback còn điều kiện `retry.on` (ví dụ `must_fix`), tăng `review_round`.
- Nếu `review_round <= retry.max`, set `current_phase = retry.restart_from` và chạy lại từ step đó theo thứ tự config.
- Nếu vượt `retry.max`, dừng và báo user cần can thiệp thủ công.
- Khi không còn điều kiện retry, reset hoặc giữ `review_round` theo config; mặc định giữ để audit.

## Q&A HITL

Nếu agent tạo/cập nhật `.dev-team-agent/tasks/<task-id>/qa.md`:

1. Dừng pipeline ngay.
2. Đặt `hitl_pending = "qa"`.
3. Thông báo:

```text
⚠️ Agent có câu hỏi blocking. Vui lòng đọc .dev-team-agent/tasks/<task-id>/qa.md, điền Answer, rồi gõ "done".
```

Khi user xác nhận `done`, đọc lại state, set `hitl_pending = null`, spawn lại step có `id == current_phase`.

Q&A format:

```markdown
# Q&A — <task-id>

## Q1: <câu hỏi ngắn gọn>
**Context**: <vì sao cần hỏi>
**Options**:
- A: ...
- B: ...
**Answer**: <user điền>
```

## HITL-doc

Chỉ chạy khi gate có `optional_doc_review: true` và user chọn `yes`, hoặc khi `auto_review=true` và gate không `blocking`.

Procedure:

1. Set `hitl_pending = "hitl-doc"`.
2. Tăng `doc_review_round[<artifact-base>]`.
3. Validate `doc_reviewer.rule_category` nếu required.
4. Spawn `doc_reviewer.agent` với `--doc=<artifact-base>`.
5. Agent ghi `{doc}-po.md`.
6. Nếu PO rỗng/không có issue, tiếp tục pipeline.
7. Nếu PO có issue, gọi lại agent nguồn để sửa artifact gốc, rồi chạy doc-review lại theo giới hạn hợp lý hoặc chờ human nếu lặp.

## Subtask inheritance

Khi dùng `--subtask-of=<parent-id>`:

- Set `parent_task_id` trong state.
- Mặc định `inherit_from_parent = ["investigate.md", "design.md"]`, trừ khi per-task config khai khác.
- Trước step đầu, nếu artifact kế thừa chưa có trong subtask và tồn tại ở parent, copy vào `.dev-team-agent/tasks/<task-id>/` hoặc truyền path parent cho agent đọc.
- Nếu artifact kế thừa đã hợp lệ và step hiện tại chỉ sinh artifact đó, có thể skip step đó.
- Không ghi artifact vào workspace parent.

## Export JSON

Khi `export_json = true`, merge không phá dữ liệu cũ:

```json
{
  "task_id": "<task-id>",
  "version": 1,
  "phases": {
    "<export_key>": { "...": "structured summary" }
  }
}
```

Merge algorithm:

1. Nếu file tồn tại, đọc JSON hiện tại.
2. Cập nhật hoặc thêm `phases[step.export_key]` bằng summary mới nhất.
3. Ghi atomic nếu có thể: ghi file tạm rồi rename.
4. Không xoá key của phase khác.

## Completion

Khi chạy hết mọi step:

- Set `current_phase = "completed"` nếu cần dashboard đọc trạng thái cuối.
- Set `hitl_pending = null`.
- Báo hoàn tất và liệt kê artifact chính đã tạo theo `steps[].produces`.
- Nếu có PR artifact hoặc PR URL từ agent, đặt nó ở cuối phản hồi.

## Bundled references

- `assets/pipeline.default.yaml`: default pipeline 6 bước.
- `assets/pipeline.task-override.example.yaml`: ví dụ patch per-task.
