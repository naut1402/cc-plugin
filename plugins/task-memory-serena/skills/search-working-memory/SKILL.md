---
name: search-working-memory
description: Tìm kiếm working memory theo tên key và tùy chọn nội dung qua Serena MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
argument-hint: `<query> [--prefix=<prefix>] [--content] [--limit=N]`
---

# Search Working Memory

Tìm kiếm trong hệ thống working memory Serena: lọc danh sách key theo pattern và tùy chọn tìm kiếm trong nội dung.

## Đầu vào

`$ARGUMENTS` = `<query> [--prefix=<prefix>] [--content] [--limit=N]`

| Tham số | Bắt buộc | Mô tả |
|---------|----------|-------|
| `<query>` | ✅ | Từ khóa tìm kiếm. Khớp với tên key (case-insensitive substring match). |
| `--prefix=<prefix>` | ❌ | Lọc chỉ các key bắt đầu bằng prefix. Ví dụ: `--prefix=domain-`, `--prefix=task-`, `--prefix=knowhow/` |
| `--content` | ❌ | Nếu có: đọc từng memory tìm thấy và lọc theo `query` trong nội dung |
| `--limit=N` | ❌ | Số kết quả tối đa trả về (mặc định: 10) |

Nếu thiếu `query`: báo lỗi ngay và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Tách `query`, `--prefix`, `--content`, `--limit` từ `$ARGUMENTS`. Mặc định `limit=10`.

### 2. Lấy danh sách memory

Gọi Serena MCP tool `list_memories` (không tham số) → nhận danh sách tất cả tên memory.

Nếu lỗi hoặc danh sách rỗng: trả về `SEARCH ERROR` và dừng.

### 3. Lọc theo tên key

Áp dụng theo thứ tự:

1. Nếu có `--prefix`: giữ lại những key bắt đầu bằng `<prefix>`.
2. Tìm `<query>` trong tên key còn lại (case-insensitive substring). Giữ lại key nào chứa `query`.
3. Nếu không khớp key nào và không có `--prefix`: thử mở rộng — giữ tất cả key chứa bất kỳ từ nào trong `query`.
4. Áp dụng `--limit`: giữ tối đa N key đầu tiên.

### 4. Tìm trong nội dung (chỉ khi có `--content`)

Với mỗi key sau bước lọc:
- Gọi `read_memory(memory_name=<key>)`.
- Kiểm tra `query` có xuất hiện trong nội dung không (case-insensitive).
- Nếu có: trích xuất excerpt — tối đa 5 dòng quanh lần xuất hiện đầu tiên.
- Nếu không có: **loại key này khỏi kết quả**.

Lưu ý: nếu `--content` được dùng, chỉ trả về những key mà nội dung thực sự khớp với `query`.

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
