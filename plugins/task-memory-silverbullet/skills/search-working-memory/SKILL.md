---
name: search-working-memory
description: Tìm kiếm working memory theo tên key và tùy chọn nội dung qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
argument-hint: `<query> [--task=<task-id>] [--content] [--limit=N]`
user-invocable: false
---

# Search Working Memory

Tìm kiếm trong hệ thống working memory qua SilverBullet: lọc danh sách document theo pattern và tùy chọn tìm kiếm trong nội dung.

## Đầu vào

`$ARGUMENTS` = `<query> [--task=<task-id>] [--content] [--limit=N]`

| Tham số | Bắt buộc | Mô tả |
|---------|----------|-------|
| `<query>` | ✅ | Từ khóa tìm kiếm. Khớp với tên doc (case-insensitive substring match). |
| `--task=<task-id>` | ❌ | Giới hạn tìm kiếm trong folder của một task cụ thể. Ví dụ: `--task=task-B4488` |
| `--content` | ❌ | Nếu có: tìm `query` trong nội dung của từng note tìm thấy |
| `--limit=N` | ❌ | Số kết quả tối đa trả về (mặc định: 10) |

Nếu thiếu `query`: báo lỗi ngay và dừng.

## Các bước thực hiện

### 1. Xác định project-name

Lấy basename của thư mục làm việc hiện tại (current working directory) làm `project-name`.
Ví dụ: CWD = `/Users/tttuan/projects/hanbai-product` → `project-name = hanbai-product`.

### 2. Parse đầu vào

Tách `query`, `--task`, `--content`, `--limit` từ `$ARGUMENTS`. Mặc định `limit=10`.

### 3. Tìm kiếm theo tên document

Xây dựng regex pattern cho `list-notes`:
- Nếu có `--task`: `namePattern = "<project-name>/<task-id>/.*<query>.*\.md"`
- Nếu không có `--task`: `namePattern = "<project-name>/.*<query>.*\.md"`

Gọi `list-notes` với:
- `namePattern`: pattern ở trên (JavaScript regex, case-insensitive)

Từ kết quả, trích xuất `memory-key` từ mỗi filename bằng cách bỏ prefix `<project-name>/` và suffix `.md`.

Áp dụng `--limit`: giữ tối đa N kết quả.

### 4. Tìm trong nội dung (chỉ khi có `--content`)

Gọi `search-notes` với:
- `query`: `query`
- `searchType`: `content`
- `caseSensitive`: `false`
- `maxResults`: `limit * 3`
- `page`: `1`
- `contextLines`: `3`
- `concise`: `true`
- `enableCaching`: `true`

Lọc kết quả: chỉ giữ note có filename bắt đầu bằng `<project-name>/`.

Nếu có `--task`: lọc thêm chỉ các note có filename bắt đầu bằng `<project-name>/<task-id>/`.

Áp dụng `--limit`.

### 5. Trả về kết quả

**Chỉ trả về tên key (không có `--content`):**
```
SEARCH RESULT [<query>]:
KEYS FOUND (N):
- <task-id>/<doc-type>
- <task-id>/<doc-type>
- ...
---END---
```

**Trả về key + excerpt (có `--content`):**
```
SEARCH RESULT [<query>]:
MATCHES (N):
[<task-id>/<doc-type>]
<excerpt (tối đa 3 dòng context)>
---
[<task-id>/<doc-type>]
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
