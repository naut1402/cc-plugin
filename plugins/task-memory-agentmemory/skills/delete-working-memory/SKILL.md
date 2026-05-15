---
name: delete-working-memory
description: Xóa một working memory theo tên qua agentmemory MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Delete Working Memory

Xóa một working memory khỏi agentmemory.

## Đầu vào

`$ARGUMENTS` = `<memory-key>`

- `<memory-key>` (bắt buộc): Tên memory cần xóa, ví dụ `task-B4488`.

Nếu thiếu `memory-key`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Lấy `memory-key` từ `$ARGUMENTS` (token đầu tiên).

### 2. Tìm observation ID

Gọi `memory_smart_search(query="[MEMORY-KEY: <memory-key>]", limit=1)`.

Tìm entry có header khớp chính xác `[MEMORY-KEY: <memory-key>]` trong nội dung.

- Nếu không tìm thấy: trả về `DELETE RESULT: not-found [<memory-key>]` và dừng.
- Nếu tìm thấy: lấy observation ID từ kết quả.

### 3. Xóa memory

Gọi `memory_governance_delete` với:
- `memoryIds`: observation ID từ bước 2
- `reason`: `"Deleted working memory <memory-key>"`

## Kết quả trả về

**Nếu xóa thành công:**
```
DELETE RESULT: deleted [<memory-key>]
```

**Nếu memory không tồn tại:**
```
DELETE RESULT: not-found [<memory-key>]
```

**Nếu lỗi khác:**
```
DELETE ERROR [<memory-key>]: <mô tả lỗi>
```
