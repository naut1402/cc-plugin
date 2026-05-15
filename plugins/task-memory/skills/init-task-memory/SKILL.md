---
name: init-task-memory
description: Determine the relevant business domain from the context, load the corresponding domain memory, and load or initialize task memory.
argument-hint: "[Task ID should be inited memory]"
user-invocable: false
---

# Init Task Memory

Xác định domain nghiệp vụ liên quan cho một task, tải domain memory tương ứng, và tải hoặc khởi tạo task memory trong Serena.

## Input

`<task-id> <task-type> [--reset]`

### Arguments
- `<task-id>`: ID tác vụ, ví dụ `B4488`
- `<task-type>`: Loại tác vụ, một trong `Bug Fix | AI/Utility Task | Feature`
- `--reset`: xóa task memory cũ rồi tạo lại từ đầu

### Ví dụ
- `/init-task-memory B4488 "Bug Fix"`
- `/init-task-memory U00281 "AI/Utility Task" --reset`

## Workflow

### 1. Tải domain context

Gọi `/load-domain-context` để nhận diện domain và tải domain memory.

Truyền vào `$ARGUMENTS` (task ID và task type) làm hints để tăng độ chính xác nhận diện:

```
/load-domain-context "<task-id> <task-type>"
```

Ghi nhận output trả về (`DOMAINS` và `DOMAIN MEMORY CONTENT`) để dùng ở bước 3 và Output.

### 2. Thử đọc task memory
- thử đọc bằng `/read-working-memory task-<task-id>`
- nếu kết quả có nội dung: dùng lại, không overwrite
- nếu kết quả là `MEMORY NOT FOUND`: tạo mới bằng `/write-working-memory task-<task-id> --content=<skeleton>`
  - Khi cần tạo mới, dùng cấu trúc định dạng bộ nhớ làm việc từ [task-memory](task-memory.md)
  - thay `<task-id>` bằng task ID thực tế
  - thay loại tác vụ tương ứng với `<task-type>`
  - điền danh sách domain đã xác định ở bước 1 vào mục **Nghiệp vụ liên quan**
  - không tự bịa tiêu đề hoặc trạng thái nếu chưa có nguồn rõ ràng

## Output
```markdown
- <task-id> memory: ✅ có sẵn / ❌ chưa có
  - domain memory:
    - <tên nghiệp vụ> [domain-<key>]: ✅ có sẵn / ❌ chưa có
```

## Guardrails
- Không suy diễn domain nếu tín hiệu không rõ ràng.
- Nếu thiếu tool, ghi rõ phần nào không truy cập được.
