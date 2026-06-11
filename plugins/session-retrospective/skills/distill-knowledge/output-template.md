# Distilled Knowledge — <task-id>

**Ngày chắt lọc**: <YYYY-MM-DD>
**Domain liên quan**: <import, record, ...>
**Nguồn đã đọc**: <task memory, domain-*, glossary, knowhow, artifacts>

---

## 1. Glossary cần thống nhất

| Thuật ngữ trong session | Đề xuất chuẩn | Trạng thái | Lý do | Nguồn (file) |
|-------------------------|---------------|------------|-------|--------------|
| <term A> | <term chuẩn> | MỚI / CẬP NHẬT / XUNG ĐỘT / ĐÃ CÓ | <lý do> | `<path>` |

### Xung đột cần human quyết định

- <mô tả xung đột + các phương án>

---

## 2. Flow nghiệp vụ phát hiện

### 2.1 <Tên flow>

**Trạng thái**: MỚI / CẬP NHẬT / ĐÃ CÓ (trong `domain-<key>`)
**Domain**: `<key>`

```
<Bước 1>
  ↓
<Bước 2>
  ↓
<Kết quả>
```

**Component liên quan**: `<Class>::<method>()`, `<file path>`

**Khác biệt so với domain memory hiện có**: <mô tả hoặc "chưa có trong memory">

### 2.2 <Flow tiếp theo nếu có>

...

---

## 3. Kiến thức domain chắt lọc

| # | Nội dung | Loại | Trạng thái | Evidence |
|---|----------|------|------------|----------|
| 1 | <fact / constraint / quirk> | Fact / Constraint / Quirk | MỚI / CẬP NHẬT / XUNG ĐỘT / ĐÃ CÓ | `<path>` line N |

---

## 4. Đề xuất cập nhật domain memory

### `glossary`

```markdown
<!-- Draft — human review trước khi lưu -->
| Thuật ngữ | Định nghĩa | Alias (không dùng) |
|-----------|------------|-------------------|
| <term> | <định nghĩa> | <alias cũ> |
```

### `domain-<key>`

**Section đề xuất**: `## <heading>`

```markdown
<!-- Draft — human review trước khi lưu -->
<nội dung draft>
```

### `knowhow/<topic>` (nếu có)

```markdown
<!-- Draft — human review trước khi lưu -->
<nội dung draft>
```

---

## 5. Hành động cho human

> Skill này **không tự ghi** memory. Sau khi review, human chạy lệnh bên dưới.

| # | Hành động | Memory key | Lệnh gợi ý |
|---|-----------|------------|------------|
| 1 | Thêm/cập nhật glossary | `glossary` | `/edit-working-memory glossary --section="## <heading>" --content="..."` |
| 2 | Cập nhật domain flow | `domain-<key>` | `/edit-working-memory domain-<key> --section="## Flow: <tên>" --content="..." --mode=append` |
| 3 | Thêm knowhow | `knowhow/<topic>` | `/write-working-memory knowhow/<topic> --content="..."` |

### Checklist trước khi lưu

- [ ] Đã xác nhận thuật ngữ chuẩn với team
- [ ] Đã đối chiếu flow với code thực tế
- [ ] Không ghi đè nội dung domain memory đang đúng
- [ ] Đã chọn đúng memory backend (Serena / SilverBullet / agentmemory)
