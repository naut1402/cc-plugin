---
name: write-working-memory
description: Ghi toàn bộ nội dung working memory (tạo mới hoặc replace/append) qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Write Working Memory

Ghi toàn bộ nội dung vào một working memory qua SilverBullet. Tạo mới nếu chưa tồn tại, cập nhật nếu đã có.

Mỗi memory là một SilverBullet note tại path `<project-name>/<memory-key>.md`, trong đó `<memory-key>` thường có dạng `task-[ID]/[doc-type]` (ví dụ `task-B4488/task-B4488`, `task-B4488/survey-QA1`).

## Đầu vào

`$ARGUMENTS` = `<memory-key> --content=<text> [--mode=replace|append]`

- `<memory-key>` (bắt buộc): Key có dạng `<task-id>/<doc-type>`, ví dụ `task-B4488/task-B4488`, `task-B4488/survey-QA1`.
- `--content=<text>` (bắt buộc): Nội dung cần ghi.
- `--mode=replace|append` (tùy chọn, mặc định: `replace`):
  - `replace`: Ghi đè toàn bộ nội dung cũ.
  - `append`: Thêm nội dung mới vào cuối.

Nếu thiếu `memory-key` hoặc `--content`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Xác định project-name

Lấy basename của thư mục làm việc hiện tại (current working directory) làm `project-name`.
Ví dụ: CWD = `/Users/tttuan/projects/hanbai-product` → `project-name = hanbai-product`.

### 2. Parse đầu vào

Từ `$ARGUMENTS`, xác định `memory-key`, `content`, `mode` (mặc định `replace`).

Tính `note-path = <project-name>/<memory-key>.md`.

### 3. Xử lý mode append

Nếu `mode = append`:
- Gọi `read-note(filename="<note-path>", suggestSimilar=false)`.
- Nếu note tồn tại: `final_content = <old_content> + "\n\n" + content`.
- Nếu không tồn tại: `final_content = content`.

Nếu `mode = replace`:
- `final_content = content`

### 4. Ghi note

Gọi `create-note` với:
- `filename`: `<note-path>`
- `content`: `final_content`
- `overwrite`: `true`

### 5. Xác định trạng thái

- Nếu bước 3 đọc được note cũ: trạng thái là `replaced` (hoặc `appended` nếu append mode).
- Nếu bước 3 không tìm thấy note cũ: trạng thái là `created`.

## Kết quả trả về

```
WRITE RESULT: <created|replaced|appended> [<memory-key>]
```

Nếu lỗi:
```
WRITE ERROR [<memory-key>]: <mô tả lỗi>
```
