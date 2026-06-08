# Example Rule: SilverBullet Hashtag Tagging Convention

Quy tắc gắn hashtag khi thao tác với working memory qua SilverBullet.

## Quy tắc 1 — Task memory chính

Mỗi task memory phải chứa hashtag `#task-{TaskID}` ngay bên dưới title lớn nhất của note.

**Memory key**: `task-<ID>/task-<ID>`

```markdown
# Task: B4488
#task-B4488

## Loại tác vụ
Bug Fix

...
```

## Quy tắc 2 — Sub-memory cùng task

Mỗi sub-memory phải chứa **2 hashtag** ngay bên dưới title lớn nhất:
- Hashtag trả ngược về task cha: `#task-{TaskID}`
- Hashtag định danh chính sub-memory: `#task-{TaskID}-{Memory_Name}`

| Loại memory | Memory key                  | Hashtags                                       |
|-------------|------------------------------|------------------------------------------------|
| Survey      | `task-<ID>/survey-<TITLE>`   | `#task-<ID>` `#task-<ID>-survey-<TITLE>`       |
| Q&A         | `task-<ID>/qa`               | `#task-<ID>` `#task-<ID>-qa`                   |
| Knowledge   | `task-<ID>/knowledge`        | `#task-<ID>` `#task-<ID>-knowledge`            |

### Ví dụ — Survey

**Memory key**: `task-B4488/survey-login-flow`

```markdown
# Survey: Login Flow
#task-B4488 #task-B4488-survey-login-flow

## Tổng quan
...
```

### Ví dụ — Q&A

**Memory key**: `task-B4488/qa`

```markdown
# Q&A
#task-B4488 #task-B4488-qa

## Q1: ...
...
```

### Ví dụ — Knowledge

**Memory key**: `task-B4488/knowledge`

```markdown
# Knowledge
#task-B4488 #task-B4488-knowledge

## Khái niệm liên quan
...
```

## Quy tắc 3 — Tham chiếu sub-memory trong task memory

Khi task memory liệt kê sub-memory trong mục **Output tài liệu**, ghi kèm hashtag của sub-memory đó.

```markdown
## Output tài liệu
- Survey login flow: [[hanbai-product/task-B4488/survey-login-flow]] #task-B4488-survey-login-flow
- Q&A: [[hanbai-product/task-B4488/qa]] #task-B4488-qa
- Knowledge: [[hanbai-product/task-B4488/knowledge]] #task-B4488-knowledge
```

> `hanbai-product` là `<project-name>` — basename của thư mục làm việc hiện tại (CWD). Thay bằng tên project thực tế.

## Tóm tắt format hashtag

```
Task memory:  #task-{TaskID}
Survey:       #task-{TaskID}  #task-{TaskID}-survey-{SURVEY_TITLE}
Q&A:          #task-{TaskID}  #task-{TaskID}-qa
Knowledge:    #task-{TaskID}  #task-{TaskID}-knowledge
```
