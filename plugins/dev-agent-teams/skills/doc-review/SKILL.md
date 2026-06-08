---
name: doc-review
description: Review tài liệu investigate.md hoặc design.md theo tiêu chí chất lượng, tạo file pointout (PO). Dùng khi cần review một tài liệu kỹ thuật cho task cụ thể. Gọi trực tiếp bằng `/doc-review <task-id> --doc=<investigate|design>`.
argument-hint: "<task-id> --doc=<investigate|design>"
user-invocable: true
---

# Doc Review

Tiêu chí đánh giá chất lượng tài liệu kỹ thuật (`investigate.md`, `design.md`) và format pointout (PO).

## Workflow khi gọi trực tiếp

`$ARGUMENTS` = `<task-id> --doc=<investigate|design>`

1. Đọc `tasks/<task-id>/<doc>.md` toàn bộ.
2. Áp dụng tiêu chí C1–C8 (và D1–D3 nếu là `design`).
3. Tính điểm và xác định ngưỡng PASS/PARTIAL/FAIL.
4. Ghi `tasks/<task-id>/<doc>-po.md` theo format bên dưới.
5. Báo cáo kết quả: tổng điểm, ngưỡng, số PO.

## Tiêu chí review chung (C1–C6)

| # | Tiêu chí | Mô tả | Trọng số |
|---|---|---|---|
| C1 | Diễn đạt rõ ràng | Mỗi câu chỉ một ý, không mơ hồ | 15% |
| C2 | Độ dài câu | Câu dưới 80 ký tự, tránh câu phức nhiều mệnh đề | 10% |
| C3 | List vs prose | Dùng bullet list cho enumeration, không dùng prose | 10% |
| C4 | Nhất quán thuật ngữ | Một khái niệm dùng một tên xuyên suốt tài liệu | 15% |
| C5 | Logic không gây nhầm | Mô tả file/method/vị trí sửa nhất quán giữa các section | 25% |
| C6 | Văn phong kỹ thuật | Trung tính, không chủ quan, không dùng ngôn ngữ cảm xúc | 10% |

## Tiêu chí ngôn ngữ (C7–C8)

| # | Tiêu chí | Quy tắc |
|---|---|---|
| C7 | Thuật ngữ JP có dịch VN | Mỗi cụm JP phải kèm `(bản dịch)` lần đầu xuất hiện |
| C8 | Nhất quán ngôn ngữ | JP: tên màn hình/chức năng · VN: mô tả nghiệp vụ · EN: code identifier |

## Tiêu chí bổ sung cho design.md (D1–D3)

| # | Tiêu chí | Pass condition |
|---|---|---|
| D1 | §4 đủ chi tiết | Liệt kê đủ files, logic thay đổi, DB changes (nếu có) |
| D2 | §5 đủ test notes | Có normal flow, abnormal flow, regression risk |
| D3 | Tên nhất quán | Tên file/class/method trong §4 khớp với investigate.md |

## Format `{doc}-po.md`

```markdown
# Pointout — <doc-type> — <task-id>

## Tổng điểm: <điểm>/100 — <PASS|PARTIAL|FAIL>

| Tiêu chí | Điểm | Trạng thái |
|---|---|---|
| C1 | /15 | PASS/PARTIAL/FAIL |
...

## Danh sách PO

### PO-1: <tiêu chí> — <mô tả ngắn>
**Vị trí**: Section X, dòng Y
**Vấn đề**: <mô tả cụ thể>
**Gợi ý sửa**: <cách sửa>

### PO-2: ...
```

## Ngưỡng

- **PASS**: ≥ 85 điểm tổng, D1–D3 đều PASS (với design.md)
- **PARTIAL**: 70–84 điểm
- **FAIL**: < 70 điểm hoặc có D1/D2/D3 FAIL

Nếu PASS và không có PO: tài liệu đạt, pipeline tiếp tục.
Nếu có PO: orchestrator gọi lại agent nguồn để sửa.
