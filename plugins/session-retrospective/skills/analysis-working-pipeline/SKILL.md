---
name: analysis-working-pipeline
description: Phân tích luồng làm việc session hiện tại, vẽ sơ đồ suy luận AI và đề xuất cải tiến pipeline. Dùng sau khi xong task hoặc khi muốn retrospective session, gõ /analysis-working-pipeline.
argument-hint: "[task-id] [--focus=investigator|designer|implementer|reviewer]"
user-invocable: true
---

# Analysis Working Pipeline

Phân tích luồng chạy thực tế của session hiện tại: tái dựng timeline, vẽ sơ đồ suy luận AI, tự hỏi tối ưu từng bước, đề xuất cải tiến. **Chỉ xuất báo cáo** — không tự sửa skill, rule hay orchestrator.

## Đầu vào

`$ARGUMENTS` = `[<task-id>] [--focus=<phase>]`

- `<task-id>`: ID tác vụ. Nếu bỏ trống, suy ra từ session hoặc phân tích toàn session.
- `--focus`: Giới hạn phân tích một phase — `investigator` | `designer` | `implementer` | `reviewer` | `pr-creator` | `orchestrator` | `ad-hoc`.

### Ví dụ

- `/analysis-working-pipeline`
- `/analysis-working-pipeline B4488`
- `/analysis-working-pipeline B4488 --focus=investigator`

## Workflow

### 1. Tái dựng timeline session

Quét hội thoại và tool calls trong session hiện tại. Liệt kê **các phase thực tế đã xảy ra** (không chỉ pipeline lý thuyết):

| Phase có thể gặp | Dấu hiệu nhận diện |
|------------------|-------------------|
| `prepare-context` | Gọi `/prepare-context`, `/init-task-memory` |
| `investigator` | Spawn investigator, ghi `investigate.md` |
| `hitl-1` | User approve investigate, doc-review gate |
| `designer` | Spawn designer, ghi `design.md` |
| `hitl-2` | User approve design |
| `implementer` | Code changes, `lint.md` (if opt-in) |
| `reviewer` | `review.md`, `test-spec.md` |
| `hitl-3` | User review git diff |
| `pr-creator` | `pr-desc.md` |
| `doc-reviewer` | `*-po.md` |
| `qa-hitl` | `qa.md` được tạo/cập nhật |
| `ad-hoc` | Bước không thuộc pipeline chuẩn |

Với mỗi phase (hoặc phase trong `--focus`):

1. **Mục tiêu** — agent/user muốn đạt gì
2. **Các bước** — thứ tự thao tác thực tế
3. **Tool/Skill** — MCP, Task subagent, skill invoke, file read/write
4. **Kết quả** — artifact tạo ra hoặc quyết định rẽ nhánh

Đọc thêm artifacts trong `.dev-team-agent/tasks/<task-id>/` và `.dev-team-agent/.dev-state/<task-id>.json` (nếu có) để bổ sung timeline.

### 2. Vẽ sơ đồ suy luận AI

Tạo mermaid `flowchart TD` mô tả luồng suy luận và rẽ nhánh:

- **Node loại**: user request, skill invoke, tool call, quyết định (diamond), HITL checkpoint, retry loop, artifact output
- **Edge**: điều kiện rẽ nhánh (`approved`, `feedback`, `qa.md`, `MEMORY NOT FOUND`, ...)
- **Quy tắc mermaid**: node ID không có space; label tiếng Việt/Anh đặt trong `["..."]` hoặc `[<label>]`

Tham khảo mẫu trong [output-template.md](output-template.md).

### 3. Self-question framework

Áp dụng **cho mỗi bước trong mỗi phase** (hoặc phase được `--focus`). Ghi câu trả lời vào báo cáo — không bỏ qua phase nào có vấn đề rõ ràng.

#### Câu hỏi 1: Gộp bước nhỏ

> Những bước nào đang gọi nhiều xử lý nhỏ mà có thể tối ưu?

- Đếm số lần gọi tool/skill lặp (grep, read file, search_symbol, ...)
- Xác định pattern lặp: cùng mục đích, có thể gộp thành một skill hoặc batch
- Đề xuất cụ thể: skill mới, tham số batch, hoặc checklist trong skill hiện có

#### Câu hỏi 2: Skill / Rule cần mô tả

> Những công cụ nào cần được mô tả cách sử dụng vào rule hoặc skill cụ thể để agent tăng tốc về sau?

- Tool/skill agent dùng sai, dùng lặp, hoặc thiếu hướng dẫn
- Đề xuất **file cụ thể**: `plugins/<plugin>/skills/<name>/SKILL.md`, `.cursor/rules/<rule>.mdc`, agent definition
- Nêu **nội dung cần thêm** (ngắn gọn, actionable)

#### Câu hỏi 3: Tự động hóa

> Những yếu tố nào có thể tự động mà không cần human review?

- Bước hiện đang HITL nhưng output deterministic / rủi ro thấp
- Tham chiếu pattern có sẵn (ví dụ `--auto-review` trong orchestrator)
- Đánh giá rủi ro: **Thấp** | **Trung bình** | **Cao** — chỉ đề xuất auto khi rủi ro Thấp hoặc Trung bình có mitigation

### 4. Đề xuất cải tiến

Tổng hợp từ self-question framework. Phân loại:

| Loại | Mô tả |
|------|-------|
| `Tối ưu bước` | Gộp/giảm số lần gọi tool |
| `Skill/Rule mới` | Bổ sung hướng dẫn hoặc skill mới |
| `Tự động hóa` | Bỏ/giảm HITL cho bước an toàn |
| `Giảm token/latency` | Giảm context thừa, đọc file không cần thiết |

Ưu tiên: **P0** (blocker/lặp nhiều) → **P1** (cải thiện đáng kể) → **P2** (nice-to-have).

Mỗi đề xuất gồm: mô tả, effort (S/M/L), impact, phạm vi file/plugin cần sửa.

### 5. Output

1. Tạo thư mục `.dev-team-agent/tasks/<task-id>/` nếu có task-id và chưa có.
2. Ghi báo cáo theo [output-template.md](output-template.md):
   - Có `task-id` → `.dev-team-agent/tasks/<task-id>/pipeline-analysis.md`
   - Không có `task-id` → `pipeline-analysis-<YYYY-MM-DD>.md` tại thư mục làm việc
3. Thông báo user đường dẫn file và tóm tắt top 3 đề xuất P0/P1.

## Guardrails

- Phân tích dựa trên **session thực tế** — không mô tả pipeline lý tưởng nếu session không chạy qua đó.
- Phân biệt rõ:
  - **Đề xuất thay đổi skill/rule** → ghi trong báo cáo, human implement sau
  - **Đề xuất thay đổi orchestrator** → ghi riêng, không tự sửa orchestrator
- **Không tự tạo/sửa** skill, rule, agent, hay file config.
- Nếu session quá ngắn (< 3 bước có ý nghĩa): báo user thay vì tạo báo cáo generic.
- `--focus` chỉ phân tích phase chỉ định nhưng vẫn ghi ngữ cảnh phase trước/sau nếu ảnh hưởng.

## Output trả về cho user

```markdown
✅ Đã phân tích pipeline → .dev-team-agent/tasks/<task-id>/pipeline-analysis.md

Tóm tắt:
- Phases: <N> | Tool calls ước tính: ~<N>
- Top đề xuất:
  1. [P0] <đề xuất ngắn>
  2. [P1] <đề xuất ngắn>
  3. [P1] <đề xuất ngắn>

⚠️ Báo cáo chỉ đề xuất — không tự sửa skill/rule. Review và implement theo ưu tiên.
```
