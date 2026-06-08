---
name: read-working-memory
description: Đọc nội dung working memory theo tên qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Read Working Memory

Đọc toàn bộ nội dung của một working memory từ SilverBullet.

## Đầu vào

`$ARGUMENTS` = `<memory-key>`

- `<memory-key>` (bắt buộc): Key có dạng `<task-id>/<doc-type>`, ví dụ `task-B4488/task-B4488`, `task-B4488/survey-QA1`, `task-B4488/detail-design`.

Nếu thiếu `memory-key`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Xác định project-name

Lấy basename của thư mục làm việc hiện tại (current working directory) làm `project-name`.
Ví dụ: CWD = `/Users/tttuan/projects/hanbai-product` → `project-name = hanbai-product`.

### 2. Parse đầu vào

Lấy `memory-key` từ `$ARGUMENTS` (token đầu tiên).

Tính `note-path = <project-name>/<memory-key>.md`.

### 3. Đọc note

Gọi silverbullet MCP tool `read-note` với:
- `filename`: `<note-path>`
- `suggestSimilar`: `false`

### 4. Xử lý kết quả

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
