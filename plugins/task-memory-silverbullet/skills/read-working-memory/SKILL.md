---
name: read-working-memory
description: Đọc nội dung working memory theo tên qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Read Working Memory

Đọc toàn bộ nội dung của một working memory từ SilverBullet.

## Đầu vào

`$ARGUMENTS` = `<memory-key>`

- `<memory-key>` (bắt buộc): Tên memory cần đọc, ví dụ `task-B4488`, `glossary`, `domain-import`.

Nếu thiếu `memory-key`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Lấy `memory-key` từ `$ARGUMENTS` (token đầu tiên).

### 2. Đọc note

Gọi silverbullet MCP tool `read-note` với:
- `filename`: `working-memory/<memory-key>.md`
- `suggestSimilar`: `false`

### 3. Xử lý kết quả

- Nếu thành công: lấy toàn bộ nội dung note trả về.
- Nếu note không tồn tại (tool báo lỗi not found): trả về `MEMORY NOT FOUND`.
- Nếu lỗi khác: trả về `MEMORY READ ERROR`.

## Kết quả trả về

**Nếu đọc thành công:**
```
MEMORY CONTENT [<memory-key>]:
<nội dung note>
---END---
```

**Nếu memory không tồn tại:**
```
MEMORY NOT FOUND: <memory-key>
```

**Nếu lỗi khác:**
```
MEMORY READ ERROR [<memory-key>]: <mô tả lỗi>
```
