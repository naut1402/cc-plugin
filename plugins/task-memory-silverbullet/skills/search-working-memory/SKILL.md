---
name: search-working-memory
description: Tìm kiếm working memory theo tên key và tùy chọn nội dung qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
argument-hint: `<query> [--prefix=<prefix>] [--content] [--limit=N]`
user-invocable: false
---

# Search Working Memory

Tìm kiếm trong hệ thống working memory qua SilverBullet: lọc danh sách key theo pattern và tùy chọn tìm kiếm trong nội dung.

## Đầu vào

`$ARGUMENTS` = `<query> [--prefix=<prefix>] [--content] [--limit=N]`

| Tham số | Bắt buộc | Mô tả |
|---------|----------|-------|
| `<query>` | ✅ | Từ khóa tìm kiếm. Khớp với tên key (case-insensitive substring match). |
| `--prefix=<prefix>` | ❌ | Lọc chỉ các key bắt đầu bằng prefix. Ví dụ: `--prefix=domain-`, `--prefix=task-` |
| `--content` | ❌ | Nếu có: tìm `query` trong nội dung của từng note tìm thấy |
| `--limit=N` | ❌ | Số kết quả tối đa trả về (mặc định: 10) |

Nếu thiếu `query`: báo lỗi ngay và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Tách `query`, `--prefix`, `--content`, `--limit` từ `$ARGUMENTS`. Mặc định `limit=10`.

### 2. Tìm kiếm theo tên key

Xây dựng regex pattern cho `list-notes`:
- Nếu có `--prefix`: `namePattern = "working-memory/<prefix>.*<query>.*\\.md"`
- Nếu không có `--prefix`: `namePattern = "working-memory/.*<query>.*\\.md"`

Gọi `list-notes` với:
- `namePattern`: pattern ở trên (JavaScript regex, case-insensitive)

Từ kết quả, trích xuất `memory-key` từ mỗi filename bằng cách bỏ prefix `working-memory/` và suffix `.md`.

Áp dụng `--limit`: giữ tối đa N kết quả.

### 3. Tìm trong nội dung (chỉ khi có `--content`)

Gọi `search-notes` với:
- `query`: `query`
- `searchType`: `content`
- `caseSensitive`: `false`
- `maxResults`: `limit * 3`
- `page`: `1`
- `contextLines`: `3`
- `concise`: `true`
- `enableCaching`: `true`

Lọc kết quả: chỉ giữ note có filename bắt đầu bằng `working-memory/`.

Nếu có `--prefix`: lọc thêm chỉ các note có key bắt đầu bằng `<prefix>`.

Áp dụng `--limit`.

### 4. Trả về kết quả

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
<excerpt (tối đa 3 dòng context)>
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
