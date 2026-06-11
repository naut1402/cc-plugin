---
name: survey-codebase
description: Hướng dẫn survey codebase cho PHP project hanbai-product. Reference skill — dùng nội bộ bởi investigator agent.
user-invocable: false
---

# Survey Codebase

Hướng dẫn cách đọc và phân tích codebase 楽楽販売 (hanbai-product) để tạo `investigate.md`.

## Format từ project rule (bắt buộc)

Format của `investigate.md` **phải** lấy từ "Rule viết tài liệu" (doc-writing) mà orchestrator đã nạp và truyền vào `tasks/<task-id>/project-rules.md`. Đọc phần đó và tuân theo cấu trúc, văn phong, ngôn ngữ quy định.

**Nếu phần doc-writing trống / không có rule**: dừng xử lý, báo orchestrator — **không** dùng format mẫu bên dưới làm fallback.

Format `investigate.md` bên dưới chỉ là **ví dụ tham khảo cấu trúc**.

> Khi chạy độc lập không qua orchestrator: tự nạp doc-writing rule qua skill `read-project-rules` trước; vẫn áp dụng quy tắc bắt buộc ở trên.

## Mục tiêu

Xác định chính xác phạm vi ảnh hưởng (blast radius) của task, trace call chain từ entry point, tránh bỏ sót hoặc over-scope.

## Quy trình survey

### 1. Đọc issue và xác định entry point

- Đọc kỹ issue: description, steps to reproduce, acceptance criteria.
- Xác định màn hình / chức năng liên quan → tìm controller/action tương ứng.
- Dùng Serena MCP `find_symbol` hoặc `find_implementations` để locate code.

### 2. Trace call chain

Từ entry point (controller action), trace xuống:
- Controller → Service → Repository → DB
- Ghi lại từng layer: `ClassName::methodName()` → `file:line`
- Dùng `find_referencing_symbols` để tìm caller của method cần sửa.

### 3. Xác định phạm vi ảnh hưởng

Với mỗi method cần sửa, kiểm tra:
- Những nơi khác gọi method này (side effects)
- Shared utility functions có bị ảnh hưởng không
- DB schema liên quan (table, column, foreign key)
- Session / cache liên quan

### 4. Kiểm tra test coverage

- Tìm file test tương ứng (pattern: `test/` hoặc `tests/` + tên class)
- Ghi nhận coverage hiện tại và test nào có thể bị break

### 5. Confidence scoring

Với mỗi phát hiện, gán confidence:
- **High**: đã đọc code trực tiếp, logic rõ ràng
- **Medium**: suy luận từ naming/pattern, chưa xác nhận toàn bộ
- **Low**: giả định, cần xác nhận thêm

## Format `investigate.md`

```markdown
# Investigate — <task-id>

## 1. Tổng quan
<mô tả ngắn vấn đề và scope>

## 2. Entry points
| Màn hình / Chức năng | Controller | Action | File |
|---|---|---|---|

## 3. Call chain
<flow dạng text hoặc list lồng nhau>
ControllerClass::action()
  └─ ServiceClass::method() [file:line]
       └─ RepositoryClass::query() [file:line]

## 4. Phạm vi ảnh hưởng
- Files cần sửa: [list]
- Files có thể bị ảnh hưởng: [list]
- DB tables liên quan: [list]

## 5. Test coverage hiện tại
<mô tả>

## 6. Rủi ro và điểm cần xác nhận
| Rủi ro | Confidence | Ghi chú |
|---|---|---|

## 7. Câu hỏi chưa rõ
<nếu có — ghi vào qa.md và báo orchestrator>
```

## Lưu ý

- Không suy diễn quá scope issue. Nếu không chắc, ghi vào mục "Rủi ro" với confidence thấp.
- Nếu gặp câu hỏi cần human quyết định trước khi tiếp tục → tạo `qa.md` và dừng.
