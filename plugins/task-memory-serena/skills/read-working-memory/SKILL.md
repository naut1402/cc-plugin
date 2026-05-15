---
name: read-working-memory
description: Đọc nội dung working memory theo tên qua Serena MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Read Working Memory

Đọc toàn bộ nội dung của một working memory từ Serena.

## Đầu vào

`$ARGUMENTS` = `<memory-key>`

- `<memory-key>` (bắt buộc): Tên memory cần đọc, ví dụ `task-B4488`, `glossary`, `domain-import`.

Nếu thiếu `memory-key`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Lấy `memory-key` từ `$ARGUMENTS` (token đầu tiên).

### 2. Đọc memory

Gọi Serena MCP tool `read_memory` với `memory-key`.

### 3. Trả về kết quả

Trả về theo format sau để skill gọi có thể parse:

**Nếu đọc thành công:**
```
MEMORY CONTENT [<memory-key>]:
<nội dung>
---END---
```

**Nếu memory không tồn tại:**
```
MEMORY NOT FOUND: <memory-key>
```

**Nếu lỗi khác (network, permission...):**
```
MEMORY READ ERROR [<memory-key>]: <mô tả lỗi>
```
