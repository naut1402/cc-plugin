---
name: distill-knowledge
description: Chắt lọc glossary, flow nghiệp vụ và kiến thức domain sau khi hoàn thành task. Gợi ý human lưu domain memory đã chuẩn hóa. Dùng sau khi xong task, khi user gõ /distill-knowledge hoặc muốn tổng hợp kiến thức từ session.
argument-hint: "[task-id] [--domains=import,record]"
user-invocable: true
---

# Distill Knowledge

Chắt lọc kiến thức từ session vừa làm: thống nhất glossary, trích flow nghiệp vụ, tổng hợp facts domain. **Chỉ đề xuất** — human tự lưu vào memory sau khi duyệt.

## Đầu vào

`$ARGUMENTS` = `[<task-id>] [--domains=<key1,key2,...>]`

- `<task-id>`: ID tác vụ (`B4488`, `U00281`, `F003`, ...). Nếu bỏ trống, suy ra từ session (pattern `B\d{4,5}`, `U\d{4,6}`, `F\d{3,5}`).
- `--domains`: Giới hạn domain cần chắt lọc. Nếu bỏ trống, dùng domain nhận diện từ context.

### Ví dụ

- `/distill-knowledge B4488`
- `/distill-knowledge --domains=import,record`
- `/distill-knowledge U00281 --domains=ui`

## Workflow

### 1. Xác định context

1. Parse `task-id` và `--domains` từ `$ARGUMENTS`.
2. Nếu chưa có `task-id`: quét hội thoại và artifacts để tìm ID hợp lệ.
3. Nếu chưa có `--domains`: gọi `/load-domain-context "<task-id>"` (hoặc hints từ session) để nhận diện domain.

Bảng domain key (đối chiếu với `load-domain-context`):

| Domain Key | Từ khóa nhận diện | Tên nghiệp vụ |
|------------|-------------------|---------------|
| `import` | import, 取込, csv, excel, upload | Nhập dữ liệu |
| `export` | export, 出力, download, pdf | Xuất dữ liệu |
| `record` | record, レコード, 明細, 伝票 | Xử lý bản ghi |
| `auto` | 自動, batch, cron, schedule | Xử lý tự động |
| `master` | master, マスタ, 設定 | Quản lý master |
| `ui` | 画面, view, form, modal | Giao diện |
| `api` | api, endpoint, webhook, rest | API |

### 2. Thu thập nguồn

Đọc theo thứ tự sau. Ghi nhận nguồn nào đọc được / không có.

**Memory** (qua contract skill `/read-working-memory` — cần backend memory đã cài):

| Key | Mục đích |
|-----|----------|
| `task-<task-id>` | Context task, domain đã gán |
| `domain-<key>` | Flow và kiến thức domain hiện có (mỗi domain liên quan) |
| `glossary` | Thuật ngữ chuẩn hiện có |
| `knowhow` | Lessons learned tích lũy |

Nếu memory không tồn tại → ghi `MEMORY NOT FOUND`, tiếp tục với artifacts.

**Artifacts** (đọc từ workspace):

- `tasks/<task-id>/` — investigate.md, design.md, review.md, test-spec.md, qa.md, ...
- Tài liệu impact/survey/design ở root hoặc thư mục task nếu có (`*_impact_analysis.AI.md`, ...)
- Nội dung hội thoại session liên quan đến task

### 3. Chắt lọc (3 trục)

#### 3.1 Glossary

- Quét thuật ngữ trong artifacts và hội thoại session.
- Đối chiếu với `glossary` và domain memory.
- Với mỗi thuật ngữ:
  - Liệt kê synonym / cách gọi khác nhau trong session.
  - Đề xuất **một** tên chuẩn + lý do.
  - Gắn evidence: file path (và line nếu có).
- Phân loại: `MỚI` | `CẬP NHẬT` | `XUNG ĐỘT` | `ĐÃ CÓ`.

#### 3.2 Flow nghiệp vụ

- Trích các flow xử lý phát hiện trong session (từ investigate, design, code trace).
- Mô tả step-by-step + component/file liên quan.
- So sánh với flow đã có trong `domain-<key>`:
  - Flow hoàn toàn mới → `MỚI`
  - Bổ sung/sửa bước → `CẬP NHẬT`
  - Mâu thuẫn với memory → `XUNG ĐỘT`
  - Trùng khớp → `ĐÃ CÓ`

#### 3.3 Kiến thức domain

- Facts, constraints, quirks, business rules phát hiện trong session.
- Chỉ ghi khi có code evidence hoặc tài liệu session làm nguồn.
- Không suy đoán giá trị DB/runtime chưa xác minh — ghi `⚠️ Cần xác minh` nếu chưa có evidence.

### 4. So sánh delta

Tổng hợp tất cả mục với nhãn trạng thái. Ưu tiên hiển thị `MỚI`, `CẬP NHẬT`, `XUNG ĐỘT` trước `ĐÃ CÓ`.

### 5. Output

1. Tạo thư mục `tasks/<task-id>/` nếu chưa có.
2. Ghi báo cáo vào `tasks/<task-id>/distilled-knowledge.md` theo [output-template.md](output-template.md).
3. Điền đầy đủ section **Hành động cho human** với:
   - Memory key đề xuất
   - Nội dung draft sẵn để copy
   - Lệnh gợi ý (`/write-working-memory`, `/edit-working-memory`) — **human tự chạy**
4. Thông báo user đường dẫn file và nhắc review trước khi lưu memory.

Nếu không xác định được `task-id`: ghi `distilled-knowledge-<YYYY-MM-DD>.md` tại thư mục làm việc hiện tại.

## Guardrails

- **Không tự ghi** `glossary`, `domain-*`, `knowhow`, hay bất kỳ working memory nào.
- **Không ghi đè** task memory (`task-<id>`).
- Mọi mục phải có evidence — không suy đoán.
- Ghi rõ phần nào cần human xác nhận trước khi lưu.
- Nếu thiếu backend memory: vẫn xuất báo cáo từ artifacts, ghi chú `⚠️ Chưa đối chiếu memory` ở đầu file.
- Nếu session không có đủ nội dung để chắt lọc: báo user thay vì tạo báo cáo rỗng.

## Output trả về cho user

```markdown
✅ Đã chắt lọc kiến thức → tasks/<task-id>/distilled-knowledge.md

Tóm tắt:
- Glossary: <N> mục (MỚI: X, XUNG ĐỘT: Y)
- Flow: <N> flow
- Domain facts: <N> mục

⚠️ Vui lòng review file và tự lưu memory theo section "Hành động cho human".
```
