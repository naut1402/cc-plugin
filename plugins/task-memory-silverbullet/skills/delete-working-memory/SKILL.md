---
name: delete-working-memory
description: Xóa toàn bộ working memory của một task (cả folder) qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Delete Working Memory

Xóa toàn bộ folder working memory của một task khỏi SilverBullet (xóa tất cả documents bên trong).

## Đầu vào

`$ARGUMENTS` = `<task-id>`

- `<task-id>` (bắt buộc): ID của task cần xóa, ví dụ `task-B4488`. Toàn bộ folder `<project-name>/<task-id>/` sẽ bị xóa.

Nếu thiếu `task-id`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Xác định project-name

Lấy basename của thư mục làm việc hiện tại (current working directory) làm `project-name`.
Ví dụ: CWD = `/Users/tttuan/projects/hanbai-product` → `project-name = hanbai-product`.

### 2. Parse đầu vào

Lấy `task-id` từ `$ARGUMENTS` (token đầu tiên).

Tính `folder-prefix = <project-name>/<task-id>/`.

### 3. Liệt kê tất cả notes trong folder

Gọi `list-notes` với:
- `namePattern`: `<project-name>/<task-id>/.*\.md` (JavaScript regex, case-insensitive)

Nếu không tìm thấy note nào: trả về `DELETE RESULT: not-found`.

### 4. Xóa từng note

Với mỗi note tìm được, gọi `delete-note` với:
- `filename`: tên file của note đó

Ghi nhận số note xóa thành công và số lỗi.

## Kết quả trả về

**Nếu xóa thành công:**
```
DELETE RESULT: deleted [<task-id>] (<N> files removed)
```

**Nếu folder không tồn tại:**
```
DELETE RESULT: not-found [<task-id>]
```

**Nếu có lỗi một phần:**
```
DELETE RESULT: partial [<task-id>] (<N> deleted, <M> errors)
DELETE ERROR details: <danh sách file lỗi>
```

**Nếu lỗi hoàn toàn:**
```
DELETE ERROR [<task-id>]: <mô tả lỗi>
```
