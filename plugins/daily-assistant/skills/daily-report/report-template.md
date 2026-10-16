<!-- Mẫu báo cáo hằng ngày. Placeholder trong {…}. Đổi ngôn ngữ theo report.language. -->

**Daily report {date} — {user.name}**

**Đã làm hôm nay**
- `{task_id}` {title ngắn} — {việc đã làm} ({giờ}h, tiến độ {DD/IMP/Test/AT})

**Đang làm / kế hoạch ngày mai**
- `{task_id}` {việc tiếp theo}

**Vướng mắc / cần hỗ trợ**
- {nội dung} — hoặc: Không có

**Logwork:** {tổng giờ}/{hours_per_day}h

<!-- Mục trống ghi "Không có". Footer chỉ thêm khi có nguồn bị bỏ qua: -->
_Nguồn bỏ qua: {danh sách}_
