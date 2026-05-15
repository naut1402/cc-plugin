---
name: write-working-memory
description: Ghi toàn bộ nội dung working memory (tạo mới hoặc replace/append) qua agentmemory MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Write Working Memory

Ghi toàn bộ nội dung vào một working memory qua agentmemory. Tạo mới nếu chưa tồn tại, cập nhật nếu đã có.

Vì agentmemory là observation store (không phải key-value), mỗi memory được định danh bằng header `[MEMORY-KEY: <key>]` ở dòng đầu nội dung. Khi cập nhật, bản cũ sẽ bị xóa sau khi bản mới lưu thành công.

## Đầu vào

`$ARGUMENTS` = `<memory-key> --content=<text> [--mode=replace|append]`

- `<memory-key>` (bắt buộc): Tên memory, ví dụ `task-B4488`, `glossary`.
- `--content=<text>` (bắt buộc): Nội dung cần ghi. Nội dung này không bao gồm dòng header (skill tự thêm).
- `--mode=replace|append` (tùy chọn, mặc định: `replace`):
  - `replace`: Ghi đè toàn bộ nội dung cũ.
  - `append`: Thêm nội dung mới vào cuối.

Nếu thiếu `memory-key` hoặc `--content`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Từ `$ARGUMENTS`, xác định `memory-key`, `content`, `mode` (mặc định `replace`).

### 2. Tìm bản cũ (nếu có)

Gọi `memory_smart_search(query="[MEMORY-KEY: <memory-key>]", limit=1)`.

Nếu tìm thấy entry khớp header:
- Ghi lại `old_observation_id` để xóa sau.
- Lấy `old_body` (nội dung bỏ dòng header) nếu `mode=append`.

### 3. Xây dựng nội dung mới

- **Header**: `[MEMORY-KEY: <memory-key>]`
- `mode = replace`: `new_content = header + "\n\n" + content`
- `mode = append`:
  - Nếu có `old_body`: `new_content = header + "\n\n" + old_body + "\n\n" + content`
  - Nếu không có: `new_content = header + "\n\n" + content`

### 4. Lưu memory mới

Gọi `memory_save` với:
- `content`: `new_content`
- `concepts`: `"working-memory, key-<memory-key>"`
- `type`: `"fact"`

### 5. Xóa bản cũ

Nếu bước 2 tìm thấy `old_observation_id` và bước 4 thành công:
- Gọi `memory_governance_delete(memoryIds=<old_observation_id>, reason="Replaced by new write for key <memory-key>")`.

## Kết quả trả về

```
WRITE RESULT: <created|replaced|appended> [<memory-key>]
```

- `created`: không có bản cũ, tạo mới.
- `replaced`: có bản cũ, ghi đè.
- `appended`: có bản cũ, nối thêm.

Nếu lỗi:
```
WRITE ERROR [<memory-key>]: <mô tả lỗi>
```
