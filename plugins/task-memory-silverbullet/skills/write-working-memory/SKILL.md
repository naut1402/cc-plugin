---
name: write-working-memory
description: Ghi toàn bộ nội dung working memory (tạo mới hoặc replace/append) qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Write Working Memory

Ghi toàn bộ nội dung vào một working memory qua SilverBullet. Tạo mới nếu chưa tồn tại, cập nhật nếu đã có.

Mỗi memory là một SilverBullet note tại path `working-memory/<key>.md`.

## Đầu vào

`$ARGUMENTS` = `<memory-key> --content=<text> [--mode=replace|append]`

- `<memory-key>` (bắt buộc): Tên memory, ví dụ `task-B4488`, `glossary`.
- `--content=<text>` (bắt buộc): Nội dung cần ghi.
- `--mode=replace|append` (tùy chọn, mặc định: `replace`):
  - `replace`: Ghi đè toàn bộ nội dung cũ.
  - `append`: Thêm nội dung mới vào cuối.

Nếu thiếu `memory-key` hoặc `--content`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Từ `$ARGUMENTS`, xác định `memory-key`, `content`, `mode` (mặc định `replace`).

### 2. Xử lý mode append

Nếu `mode = append`:
- Gọi `read-note(filename="working-memory/<memory-key>.md", suggestSimilar=false)`.
- Nếu note tồn tại: `final_content = <old_content> + "\n\n" + content`.
- Nếu không tồn tại: `final_content = content`.

Nếu `mode = replace`:
- `final_content = content`

### 3. Ghi note

Gọi `create-note` với:
- `filename`: `working-memory/<memory-key>.md`
- `content`: `final_content`
- `overwrite`: `true`

### 4. Xác định trạng thái

- Nếu bước 2 đọc được note cũ: trạng thái là `replaced` (hoặc `appended` nếu append mode).
- Nếu bước 2 không tìm thấy note cũ: trạng thái là `created`.

## Kết quả trả về

```
WRITE RESULT: <created|replaced|appended> [<memory-key>]
```

Nếu lỗi:
```
WRITE ERROR [<memory-key>]: <mô tả lỗi>
```
