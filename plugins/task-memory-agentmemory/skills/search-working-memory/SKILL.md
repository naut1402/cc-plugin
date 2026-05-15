---
name: search-working-memory
description: Tìm kiếm working memory theo tên key và tùy chọn nội dung qua agentmemory MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
argument-hint: `<query> [--prefix=<prefix>] [--content] [--limit=N]`
---

# Search Working Memory

Tìm kiếm trong hệ thống working memory agentmemory: lọc danh sách key theo pattern và tùy chọn tìm kiếm trong nội dung.

## Đầu vào

`$ARGUMENTS` = `<query> [--prefix=<prefix>] [--content] [--limit=N]`

| Tham số | Bắt buộc | Mô tả |
|---------|----------|-------|
| `<query>` | ✅ | Từ khóa tìm kiếm. Khớp với tên key (case-insensitive substring match). |
| `--prefix=<prefix>` | ❌ | Lọc chỉ các key bắt đầu bằng prefix. Ví dụ: `--prefix=domain-`, `--prefix=task-`, `--prefix=knowhow/` |
| `--content` | ❌ | Nếu có: tìm `query` trong nội dung của từng memory tìm thấy |
| `--limit=N` | ❌ | Số kết quả tối đa trả về (mặc định: 10) |

Nếu thiếu `query`: báo lỗi ngay và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Tách `query`, `--prefix`, `--content`, `--limit` từ `$ARGUMENTS`. Mặc định `limit=10`.

### 2. Tìm kiếm memory

Xây dựng search query cho agentmemory:
- Base query: `"working-memory"`
- Nếu có `--prefix`: thêm `"key-<prefix>"` vào query (ví dụ: `"working-memory key-task-"`)
- Thêm `query` vào cuối: `"working-memory key-<prefix> <query>"`

Gọi `memory_recall(query=<search_query>, format="compact", limit=<limit * 3>)`.

Gọi với limit cao hơn để có đủ kết quả sau khi lọc.

### 3. Lọc kết quả

Từ kết quả trả về, với mỗi entry:
- Tìm dòng header `[MEMORY-KEY: <key>]` trong nội dung.
- Trích xuất `<key>` từ header.
- Nếu có `--prefix`: giữ lại chỉ những key bắt đầu bằng `<prefix>`.
- Kiểm tra `query` có xuất hiện trong `<key>` không (case-insensitive substring). Giữ lại nếu khớp.
- Áp dụng `--limit`: giữ tối đa N kết quả.

### 4. Tìm trong nội dung (chỉ khi có `--content`)

Với mỗi entry sau bước lọc:
- Lấy `body` (nội dung bỏ dòng header).
- Kiểm tra `query` có xuất hiện trong `body` không (case-insensitive).
- Nếu có: trích xuất excerpt — tối đa 5 dòng quanh lần xuất hiện đầu tiên.
- Nếu không có: **loại entry này khỏi kết quả**.

### 5. Trả về kết quả

**Chỉ trả về tên key (không có `--content`):**
```
SEARCH RESULT [<query>]:
KEYS FOUND (N):
- <key1>
- <key2>
- ...
---END---
```

**Trả về key + excerpt (có `--content`):**
```
SEARCH RESULT [<query>]:
MATCHES (N):
[<key1>]
<excerpt (tối đa 5 dòng)>
---
[<key2>]
<excerpt>
---
---END---
```

**Không tìm thấy:**
```
SEARCH NOT FOUND: <query>
```

**Lỗi:**
```
SEARCH ERROR [<query>]: <mô tả lỗi>
```
