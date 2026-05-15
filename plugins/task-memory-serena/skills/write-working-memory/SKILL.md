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

### 2. Xây dựng nội dung mới

- `mode = replace`: `new_content = content`
- `mode = append`: Gọi Serena `read_memory(memory_name=memory-key)` để lấy `old_content`.
  - Nếu thành công: `new_content = old_content + "\n\n" + content`
  - Nếu not found / rỗng: `new_content = content`
  - Lỗi khác: báo lỗi và dừng.

### 3. Ghi memory

Luôn gọi `write_memory(memory_name=memory-key, content=new_content)` bất kể memory có tồn tại hay không.

## Kết quả trả về

```
WRITE RESULT: <created|replaced|appended> [<memory-key>]
```

Nếu lỗi:
```
WRITE ERROR [<memory-key>]: <mô tả lỗi>
```
