---
name: write-working-memory
description: Ghi toàn bộ nội dung working memory (tạo mới hoặc replace/append) qua Serena MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Write Working Memory

Ghi toàn bộ nội dung vào một working memory qua Serena. Tạo mới nếu chưa tồn tại, cập nhật nếu đã có.

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

### 2. Kiểm tra tồn tại

Gọi Serena `read_memory(memory-key)`:
- Trả về nội dung → `exists = true`, lưu lại `old_content`.
- Lỗi not found / nội dung rỗng → `exists = false`.
- Lỗi khác → báo lỗi và dừng.

### 3. Xây dựng nội dung mới

- `exists = false`: `new_content = content`
- `exists = true, mode = replace`: `new_content = content`
- `exists = true, mode = append`: `new_content = old_content + "\n\n" + content`

### 4. Ghi memory

- `exists = false` → `write_memory(memory-key, new_content)`
- `exists = true` → `edit_memory(memory-key, new_content)`

## Kết quả trả về

```
WRITE RESULT: <created|replaced|appended> [<memory-key>]
```

Nếu lỗi:
```
WRITE ERROR [<memory-key>]: <mô tả lỗi>
```
