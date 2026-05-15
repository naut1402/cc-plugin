---
name: load-domain-context
description: Nhận diện domain nghiệp vụ liên quan từ context và tải domain memory tương ứng. Dùng khi cần biết domain của một task hoặc cần nạp nội dung domain memory trước khi làm việc.
argument-hint: "[hints hoặc keywords mô tả context, tùy chọn]"
user-invocable: true
---

# Load Domain Context

Nhận diện domain nghiệp vụ liên quan từ context hiện tại và tải domain memory tương ứng từ Serena.

## Input

`$ARGUMENTS` — tuỳ chọn. Chuỗi keyword hoặc đoạn text mô tả context để hỗ trợ nhận diện domain. Nếu không truyền, skill sẽ suy đoán từ hội thoại và file hiện tại.

### Ví dụ
- `/load-domain-context` — suy đoán hoàn toàn từ context hội thoại
- `/load-domain-context "csv import upload 取込"` — cung cấp hints rõ ràng

## Workflow

### 1. Thu thập tín hiệu

Tổng hợp tín hiệu từ các nguồn sau, theo mức ưu tiên:

1. `$ARGUMENTS` (hints do caller truyền vào)
2. Nội dung issue hoặc tài liệu hiện tại nếu có
3. Hội thoại gần nhất
4. Tên file đang mở

### 2. Nhận diện domain

Đối chiếu tín hiệu thu thập được với bảng keyword sau:

| Domain Key | Từ khóa nhận diện | Tên nghiệp vụ |
|------------|-------------------|---------------|
| `import` | import, 取込, インポート, csv, excel, upload | Nhập dữ liệu (取込) |
| `export` | export, 出力, エクスポート, download, pdf, csv出力 | Xuất dữ liệu (出力) |
| `record` | record, レコード, 明細, 伝票, 受注, 発注, 在庫 | Xử lý bản ghi (レコード処理) |
| `auto` | 自動, batch, cron, schedule, daemon, 定期 | Xử lý tự động (自動処理) |
| `master` | master, マスタ, 設定, 顧客, 商品 | Quản lý master (マスタ管理) |
| `ui` | 画面, view, form, modal, display, 表示 | Giao diện (画面) |
| `api` | api, endpoint, webhook, rest, request | API / Kết nối ngoài |

Quy tắc nhận diện:
- Có thể xác định nhiều domain cùng lúc.
- Chỉ gán domain khi có tín hiệu hợp lý — không gán bừa khi tín hiệu yếu hoặc mơ hồ.
- Nếu không xác định được domain nào, ghi nhận `chưa xác định rõ`.

### 3. Tải domain memory

Với mỗi domain đã nhận diện, thử đọc memory `domain-<key>` bằng `read_memory`:

- Nếu tồn tại → ghi nhận `có sẵn`, lưu nội dung để trả về
- Nếu không tồn tại → ghi nhận `chưa có memory`

## Output
- Skill không trả về kết quả.

## Guardrails
- Không suy diễn domain nếu tín hiệu không rõ ràng.
- Không ghi hay sửa memory — chỉ đọc.