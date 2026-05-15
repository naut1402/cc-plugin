---
name: edit-working-memory
description: Sửa một section cụ thể trong working memory qua agentmemory MCP, không đụng đến phần còn lại. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Edit Working Memory

Sửa nội dung của một section Markdown trong working memory. Chỉ thao tác trên section chỉ định, không ảnh hưởng đến phần còn lại.

> Dùng skill này khi cần cập nhật một phần nhỏ trong memory. Để ghi đè/append toàn bộ, dùng `write-working-memory`.

## Đầu vào

`$ARGUMENTS` = `<memory-key> --section=<heading> --content=<text> [--mode=replace|append]`

- `<memory-key>` (bắt buộc): Tên memory, ví dụ `task-B4488`.
- `--section=<heading>` (bắt buộc): Heading Markdown cần cập nhật, ví dụ `## Trạng thái`. Khớp chính xác (exact string).
- `--content=<text>` (bắt buộc): Nội dung mới.
- `--mode=replace|append` (tùy chọn, mặc định: `replace`):
  - `replace`: Thay toàn bộ nội dung trong section.
  - `append`: Thêm vào cuối section.

Nếu thiếu `memory-key`, `--section`, hoặc `--content`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Từ `$ARGUMENTS`, xác định `memory-key`, `section`, `content`, `mode` (mặc định `replace`).

### 2. Đọc memory

Gọi `memory_smart_search(query="[MEMORY-KEY: <memory-key>]", limit=1)`:
- Nếu không tìm thấy entry với header khớp → báo lỗi `EDIT ERROR: memory not found, use write-working-memory to create` và dừng.
- Lấy `current_body` (nội dung bỏ dòng header) và `old_observation_id`.

### 3. Xác định boundary của section

Tìm dòng khớp chính xác với `section` trong `current_body` (ví dụ: `## Trạng thái`).

Boundary của section: từ dòng heading đó đến dòng trước heading tiếp theo có cùng hoặc cao hơn level (`##` kết thúc khi gặp `##` hoặc `#` tiếp theo), hoặc đến cuối file.

### 4. Xây dựng nội dung mới

**Section tồn tại:**
- `mode = replace`: Thay toàn bộ nội dung bên trong section (giữ nguyên dòng heading).
- `mode = append`: Thêm `content` vào cuối section (trước heading tiếp theo).

**Section chưa tồn tại:**
- Thêm section mới vào cuối body: `\n\n<section>\n\n<content>`.
- Ghi nhận kết quả là `section-added`.

### 5. Ghi lại memory

Gọi `memory_save` với:
- `content`: `"[MEMORY-KEY: <memory-key>]\n\n" + new_body`
- `concepts`: `"working-memory, key-<memory-key>"`
- `type`: `"fact"`

Sau khi save thành công, gọi `memory_governance_delete(memoryIds=<old_observation_id>, reason="Edited section '<section>' in <memory-key>")`.

## Kết quả trả về

```
EDIT RESULT: <updated|appended|section-added> [<memory-key>] section="<heading>"
```

Nếu lỗi:
```
EDIT ERROR [<memory-key>]: <mô tả lỗi>
```
