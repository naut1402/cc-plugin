---
name: edit-working-memory
description: Sửa một section cụ thể trong working memory qua Serena MCP, không đụng đến phần còn lại. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Edit Working Memory

Sửa nội dung của một section Markdown trong working memory. Chỉ thao tác trên section chỉ định, không ảnh hưởng đến phần còn lại.

> Dùng skill này khi cần cập nhật một phần nhỏ trong memory. Để ghi đè/append toàn bộ, dùng `/write-working-memory`.

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

Gọi Serena `read_memory(memory-key)`:
- Memory không tồn tại → báo lỗi và dừng (skill này không tạo mới, dùng `/write-working-memory` thay thế).
- Lỗi khác → báo lỗi và dừng.

### 3. Xác định boundary của section

Tìm dòng khớp chính xác với `section` trong nội dung (ví dụ: `## Trạng thái`).

Boundary của section: từ dòng heading đó đến dòng trước heading tiếp theo có cùng hoặc cao hơn level (`##` kết thúc khi gặp `##` hoặc `#` tiếp theo), hoặc đến cuối file.

### 4. Xây dựng nội dung mới

**Section tồn tại:**
- `mode = replace`: Thay toàn bộ nội dung bên trong section (giữ nguyên dòng heading).
- `mode = append`: Thêm `content` vào cuối section (trước heading tiếp theo).

**Section chưa tồn tại:**
- Thêm section mới vào cuối memory: `\n\n<section>\n\n<content>`.
- Ghi nhận kết quả là `section-added`.

### 5. Ghi memory

Gọi `edit_memory(memory-key, nội_dung_mới)`.

## Kết quả trả về

```
EDIT RESULT: <updated|appended|section-added> [<memory-key>] section="<heading>"
```

Nếu lỗi:
```
EDIT ERROR [<memory-key>]: <mô tả lỗi>
```
