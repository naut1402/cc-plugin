---
name: read-working-memory
description: Đọc nội dung working memory theo tên qua agentmemory MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Read Working Memory

Đọc toàn bộ nội dung của một working memory từ agentmemory.

## Đầu vào

`$ARGUMENTS` = `<memory-key>`

- `<memory-key>` (bắt buộc): Tên memory cần đọc, ví dụ `task-B4488`, `glossary`, `domain-import`.

Nếu thiếu `memory-key`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Lấy `memory-key` từ `$ARGUMENTS` (token đầu tiên).

### 2. Tìm kiếm memory

Gọi agentmemory MCP tool `memory_smart_search` với:
- `query`: `"[MEMORY-KEY: <memory-key>]"`
- `limit`: `1`

### 3. Trích xuất nội dung

Từ kết quả trả về:
- Tìm entry có nội dung chứa header `[MEMORY-KEY: <memory-key>]` (exact match, case-sensitive).
- Nếu tìm thấy: lấy toàn bộ nội dung của entry đó, bỏ dòng header đầu tiên (`[MEMORY-KEY: ...]`), giữ lại phần còn lại.
- Nếu không có kết quả hoặc không entry nào khớp header: trả về `MEMORY NOT FOUND`.

### 4. Trả về kết quả

**Nếu đọc thành công:**
```
MEMORY CONTENT [<memory-key>]:
<nội dung (không có dòng header)>
---END---
```

**Nếu memory không tồn tại:**
```
MEMORY NOT FOUND: <memory-key>
```

**Nếu lỗi khác (tool error...):**
```
MEMORY READ ERROR [<memory-key>]: <mô tả lỗi>
```
