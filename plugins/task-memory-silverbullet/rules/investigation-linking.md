# Rule: Investigation File Linking & Subdirectory Organization

Quy tắc lưu trữ tài liệu điều tra và tổ chức thư mục sub-memory trong SilverBullet.

## Quy tắc 1 — Tổ chức thư mục

Tất cả memory của một task được đặt trong thư mục `<project-name>/<task-id>/`. Cấu trúc con:

```
<project-name>/
  <task-id>/
    task-<id>.md               # Task memory chính (luôn có)
    survey-<title>.md          # Tài liệu survey/điều tra sơ bộ
    detail-design-<title>.md   # Tài liệu thiết kế chi tiết
    qa.md                      # Hỏi & đáp trong quá trình điều tra
    knowledge.md               # Kiến thức nền liên quan
```

**Memory key** tương ứng:
- Task chính: `task-<ID>/task-<ID>`
- Survey: `task-<ID>/survey-<title>`
- Detail design: `task-<ID>/detail-design-<title>`
- Q&A: `task-<ID>/qa`
- Knowledge: `task-<ID>/knowledge`

## Quy tắc 2 — Investigation files lưu riêng

**Tài liệu điều tra** (survey, detail design, Q&A, research) PHẢI lưu thành file riêng biệt, KHÔNG nhúng nội dung đầy đủ vào task memory chính.

Các loại tài liệu điều tra bao gồm:
- Survey / điều tra sơ bộ
- Detail design / thiết kế chi tiết
- Impact analysis
- Q&A, hỏi đáp kỹ thuật
- Knowledge / kiến thức nền

## Quy tắc 3 — Task memory chỉ ghi title + summary + link

Trong task memory chính (`task-<ID>/task-<ID>`), mục **Output tài liệu** chỉ được chứa:
1. **Title** của tài liệu
2. **Summary ngắn** (1–2 câu, mô tả nội dung chính hoặc kết luận)
3. **Wikilink** trỏ đến file chi tiết

**KHÔNG** sao chép nội dung đầy đủ vào task memory chính.

### Ví dụ đúng

```markdown
## Output tài liệu

### Survey: Login Flow
Điều tra luồng xác thực — phát hiện token không được refresh khi session timeout.
[[hanbai-product/task-B4488/survey-login-flow]] #task-B4488-survey-login-flow

### Detail Design: Fix Token Refresh
Thiết kế giải pháp refresh token tự động, không ảnh hưởng luồng SSO hiện tại.
[[hanbai-product/task-B4488/detail-design-token-refresh]] #task-B4488-detail-design-token-refresh

### Q&A
Các câu hỏi đặt ra trong quá trình điều tra và câu trả lời từ team.
[[hanbai-product/task-B4488/qa]] #task-B4488-qa
```

### Ví dụ sai (KHÔNG làm)

```markdown
## Output tài liệu

### Survey: Login Flow
## Tổng quan
Luồng login hiện tại gồm các bước...
## Phát hiện
1. Token không được refresh...
2. Session timeout sau 30 phút...
... (toàn bộ nội dung survey)
```

## Quy tắc 4 — Khi tạo investigation file

Khi tạo một tài liệu điều tra mới:

1. **Ghi nội dung đầy đủ** vào sub-memory (`task-<ID>/survey-<title>`, v.v.) theo đúng format và hashtag (xem `task-memory-tagging.md`).
2. **Cập nhật task memory chính**: thêm entry vào mục "Output tài liệu" với title + summary + wikilink.
3. Nếu task memory chính chưa có mục "Output tài liệu", tạo mục đó.

### Thứ tự thực hiện

```
1. write-working-memory task-<ID>/survey-<title> --content=<full content>
2. edit-working-memory task-<ID>/task-<ID>       ← append entry vào "Output tài liệu"
```

## Quy tắc 5 — Tên file investigation

`<title>` trong memory key phải:
- Viết thường, dùng dấu gạch ngang thay khoảng trắng
- Ngắn gọn, mô tả nội dung chính (tối đa 4–5 từ)
- Không dùng ký tự đặc biệt

| Nội dung điều tra        | Memory key ví dụ                         |
|--------------------------|------------------------------------------|
| Survey luồng đăng nhập   | `task-B4488/survey-login-flow`           |
| Detail design fix bug    | `task-B4488/detail-design-fix-null-ptr`  |
| Điều tra DB schema       | `task-B4488/survey-db-schema`            |
| Thiết kế API mới         | `task-B4488/detail-design-new-api`       |
