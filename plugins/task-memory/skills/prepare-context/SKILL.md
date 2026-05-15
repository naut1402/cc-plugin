---
name: prepare-context
description: Chuẩn bị context làm việc cho một task
---

# Prepare Task Context
- Thiết lập context ban đầu cho một task trước khi làm việc.
- Dùng khi bắt đầu làm việc với task mới, tiếp tục task đang dở.

## Arguments
- `<task-id>`: ID tác vụ, ví dụ `/prepare-context B4488`

## Validate input
Nếu một capability không có sẵn, bỏ qua bước tương ứng và ghi rõ trong phần tổng quan. Không tự bịa dữ liệu thay thế.

## Workflow
### 1. Xác định task ID

Ưu tiên theo thứ tự sau:

1. Từ `$ARGUMENTS`
2. Từ hội thoại gần nhất
3. Từ tên file hoặc nội dung file hiện tại nếu môi trường hỗ trợ

Pattern hợp lệ:
- `B\d{4,5}` → bug fix
- `U\d{4,6}` → AI/utility task
- `F\d{3,5}` → feature

Nếu không xác định được task ID, yêu cầu người dùng cung cấp task ID và dừng command.

### 2. Phân loại task

Dựa trên prefix của task ID:

| Prefix | Loại tác vụ | Mô tả |
|--------|-------------|-------|
| `B` | Bug Fix | Sửa lỗi phát sinh |
| `U` | AI/Utility Task | Tác vụ liên quan đến AI, tiện ích, cải tiến nội bộ |
| `F` | Feature | Phát triển tính năng mới |

### 3. Khởi tạo task memory và domain context
Gọi `/init-task-memory <task-id> "<task-type>"`

### 4. Output
```markdown
LOAD CONTEXT REPORT:
<task-id> context: ✅ load success / ❌ load fail
```
### Guardrails
- Nếu thiếu tool hoặc thiếu context, phải nói rõ phần nào không truy cập được.
- Nếu không tìm được task ID, phải dừng và yêu cầu user cung cấp task ID.