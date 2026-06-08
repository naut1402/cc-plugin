---
name: delete-working-memory
description: Xóa một working memory theo tên qua SilverBullet MCP. Contract skill — chỉ dùng nội bộ bởi các skill khác.
user-invocable: false
---

# Delete Working Memory

Xóa một working memory khỏi SilverBullet.

## Đầu vào

`$ARGUMENTS` = `<memory-key>`

- `<memory-key>` (bắt buộc): Tên memory cần xóa, ví dụ `task-B4488`.

Nếu thiếu `memory-key`: báo lỗi và dừng.

## Các bước thực hiện

### 1. Parse đầu vào

Lấy `memory-key` từ `$ARGUMENTS` (token đầu tiên).

### 2. Xóa note

Gọi `delete-note` với:
- `filename`: `working-memory/<memory-key>.md`

- Nếu thành công: trả về `DELETE RESULT: deleted`.
- Nếu note không tồn tại (tool báo lỗi not found): trả về `DELETE RESULT: not-found`.
- Nếu lỗi khác: trả về `DELETE ERROR`.

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
