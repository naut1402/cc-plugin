---
name: edit-working-memory
description: Sửa một section cụ thể trong working memory qua SilverBullet MCP, không đụng đến phần còn lại. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Edit Working Memory

Sửa nội dung của một section Markdown trong working memory. Chỉ thao tác trên section chỉ định, không ảnh hưởng đến phần còn lại.

> Dùng skill này khi cần cập nhật một phần nhỏ trong memory. Để ghi đè/append toàn bộ, dùng `write-working-memory`.

## Đầu vào

`$ARGUMENTS` = `<memory-key> --section=<heading> --content=<text> [--mode=replace|append]`

- `<memory-key>` (bắt buộc): Key có dạng `<task-id>/<doc-type>`, ví dụ `task-B4488/task-B4488`.
- `--section=<heading>` (bắt buộc): Heading Markdown cần cập nhật, ví dụ `## Trạng thái`. Khớp chính xác (exact string).
- `--content=<text>` (bắt buộc): Nội dung mới.
- `--mode=replace|append` (tùy chọn, mặc định: `replace`):
  - `replace`: Thay toàn bộ nội dung trong section.
  - `append`: Thêm vào cuối section.

Nếu thiếu `memory-key`, `--section`, hoặc `--content`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Xác định project-name

Lấy basename của thư mục làm việc hiện tại (current working directory) làm `project-name`.
Ví dụ: CWD = `/Users/tttuan/projects/hanbai-product` → `project-name = hanbai-product`.

### 2. Parse đầu vào

Từ `$ARGUMENTS`, xác định `memory-key`, `section`, `content`, `mode` (mặc định `replace`).

Tính `note-path = <project-name>/<memory-key>.md`.

### 3. Đọc note hiện tại

Gọi `read-note(filename="<note-path>", suggestSimilar=false)`:
- Nếu không tìm thấy → báo lỗi `EDIT ERROR: memory not found, use write-working-memory to create` và dừng.
- Lấy `current_content` từ kết quả.

### 4. Xác định boundary của section

Tìm dòng khớp chính xác với `section` trong `current_content` (ví dụ: `## Trạng thái`).

Boundary của section: từ dòng heading đó đến dòng trước heading tiếp theo có cùng hoặc cao hơn level, hoặc đến cuối file.

### 5. Xây dựng nội dung mới

**Section tồn tại:**
- `mode = replace`: Thay toàn bộ nội dung bên trong section (giữ nguyên dòng heading).
- `mode = append`: Thêm `content` vào cuối section (trước heading tiếp theo).

**Section chưa tồn tại:**
- Thêm section mới vào cuối: `\n\n<section>\n\n<content>`.
- Ghi nhận kết quả là `section-added`.

### 6. Ghi lại note

Gọi `create-note` với:
- `filename`: `<note-path>`
- `content`: `new_content`
- `overwrite`: `true`

## Kết quả trả về

```
EDIT RESULT: <updated|appended|section-added> [<memory-key>] section="<heading>"
```

Nếu lỗi:
```
EDIT ERROR [<memory-key>]: <mô tả lỗi>
```
