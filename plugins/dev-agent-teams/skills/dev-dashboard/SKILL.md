---
name: dev-dashboard
description: Dựng và chạy dashboard realtime (Vue+Vite) trực quan hóa trạng thái pipeline của dev-team-orchestrator. Dùng khi user muốn xem tiến độ task, theo dõi pipeline investigate→design→implement→review→PR, xem HITL gate đang chờ, đọc artifact/qa.md, hoặc nói "mở dashboard", "xem trạng thái orchestrator", "visualize tiến độ task". Gõ `/dev-dashboard`.
argument-hint: "[project-root] [--no-open] [--port=<n>]"
user-invocable: true
---

# Dev Team Dashboard

Skill này scaffold và khởi chạy một web app **Vue + Vite** đọc trực tiếp filesystem `.dev-team-agent/` để trực quan hóa state của `dev-team-orchestrator`: pipeline 6 phase, các HITL gate, vòng review/doc-review, artifact và câu hỏi blocking (`qa.md`). UI tự poll mỗi ~1.5s nên phản ánh **realtime** khi orchestrator chạy.

## Mô hình thư mục

Toàn bộ state + tài liệu của orchestrator nằm dưới một root thống nhất ở gốc project:

```
<project-root>/.dev-team-agent/
  .dev-state/<task-id>.json     # state pipeline (orchestrator ghi)
  tasks/<task-id>/...           # investigate.md, design.md, review.md, qa.md, ...
  viewer/                       # app dashboard (skill này tạo ra)
```

Project cũ còn `tasks/` và `.dev-state/` ở gốc → skill **tự migrate** vào `.dev-team-agent/`.

## Đầu vào

`$ARGUMENTS` = `[project-root] [--no-open] [--port=<n>]`

- `project-root`: gốc project chứa (hoặc sẽ chứa) `.dev-team-agent/`. Mặc định = thư mục làm việc hiện tại.
- `--no-open`: không tự mở browser.
- `--port=<n>`: cổng dev server (mặc định 5174).

## Quy trình

Thực hiện tuần tự. Các bước dùng script bundle sẵn nên **không tự suy diễn lại** — chỉ chạy đúng lệnh.

### Bước 1 — Scaffold + migrate

Chạy script setup (đường dẫn tính từ thư mục skill này, `<skill-dir>/scripts/setup.mjs`):

```bash
node "<skill-dir>/scripts/setup.mjs" "<project-root>"
```

Script này (idempotent) sẽ:
1. Tạo `<project-root>/.dev-team-agent/`.
2. Migrate `tasks/` và `.dev-state/` cũ ở gốc project vào `.dev-team-agent/` (nếu có, và chưa migrate).
3. Copy viewer (Vue+Vite) vào `.dev-team-agent/viewer/` — **không** đụng `node_modules` đã cài.
4. Thêm `.dev-team-agent/` vào `.gitignore`.

Đọc output để xác nhận đã migrate gì. Nếu script báo lỗi (ví dụ không tìm thấy Node) → dừng, báo user cài Node ≥ 18.

### Bước 2 — Cài dependency (lần đầu)

Nếu `.dev-team-agent/viewer/node_modules` chưa tồn tại:

```bash
cd "<project-root>/.dev-team-agent/viewer" && npm install
```

Nếu đã có thì bỏ qua.

### Bước 3 — Chạy dev server

```bash
cd "<project-root>/.dev-team-agent/viewer" && npm run dev
```

- Tôn trọng `--port` (đặt biến môi trường hoặc sửa cờ nếu user yêu cầu) và `--no-open` (`npm run dev -- --no-open`).
- Server resolve data root = thư mục cha của `viewer/` (tức `.dev-team-agent/`). Có thể override bằng env `DEV_TEAM_ROOT` khi cần trỏ tới project khác.
- Chạy **nền** (background) để không chặn session, rồi báo user URL (mặc định http://localhost:5174).

### Bước 4 — Báo user

Thông báo:
- URL dashboard.
- Dashboard tự cập nhật realtime — cứ để mở khi chạy `/dev-team-orchestrator`.
- Dừng server: tắt tiến trình `npm run dev` (Ctrl-C hoặc kill background task).

## Chế độ đa-project (standalone server)

Để theo dõi **nhiều project** từ một dashboard duy nhất, chạy server độc lập (không nằm trong một `.dev-team-agent/` cụ thể):

```bash
cd "<project-root>/.dev-team-agent/viewer" && npm install && npm run build && npm run serve
```

- `npm run serve` chạy `server/standalone.js` (Node `node:http`): serve `dist/` tĩnh + API `/api/*`, bind `127.0.0.1:5174` (local-first; chưa expose ra mạng). `npm start` = build + serve.
- **Project registry**: danh sách project lưu ở `~/.dev-team-dashboard/projects.json` (override bằng env `DEV_TEAM_DASHBOARD_HOME`). Mỗi entry trỏ tới một thư mục `.dev-team-agent/`.
- **Thêm/xoá project**:
  - Qua UI: sidebar "Projects" → nút **＋**, nhập đường dẫn `.dev-team-agent/` (hoặc project root chứa nó) + tên hiển thị tuỳ chọn. Nút **×** gỡ project (chỉ gỡ khỏi registry, **không** xoá file). Không gỡ được project `default`.
  - Qua MCP: server `dev-team-dashboard` (khai báo ở `plugins/dev-agent-teams/.mcp.json`) cung cấp 4 tool `list_projects` / `add_project` / `remove_project` / `get_project`, dùng **chung** `projects.json` với UI/REST.
- **Tương thích ngược**: nếu set env `DEV_TEAM_ROOT`, project đó tự được seed làm `default` khi registry rỗng. Mọi endpoint cũ nhận thêm query optional `?project=<id>`; không truyền → dùng project mặc định và giữ nguyên shape `{ root, tasks }`.
- Chạy **nền** rồi báo user URL. Dừng: tắt tiến trình `npm run serve`.

## Dashboard hiển thị gì

- **Danh sách task** (dashboard tổng): mọi task trong `.dev-state/`, đánh dấu task đang chờ Q&A / HITL.
- **Pipeline**: 5 bước investigate→design→implement→review→PR với HITL gate xen giữa; bước đang chạy nhấp nháy, bước xong tick xanh, gate đang chờ duyệt highlight vàng. Status suy từ sự tồn tại artifact + `current_phase`/`hitl_pending` (đúng nguyên tắc của orchestrator).
- **Badge**: `auto_review`, `review_round`, `hitl_pending`, lỗi state.
- **QA panel**: nổi bật khi `qa.md` tồn tại — hiển thị câu hỏi blocking đang chờ trả lời.
- **Artifact panel**: liệt kê mọi tài liệu trong `tasks/<id>/`, click để xem nội dung (render markdown); tài liệu đang mở tự reload khi file đổi trên đĩa.

## API nội bộ (dev-server middleware)

Viewer không cần process server riêng — `vite.config.js` nhúng plugin đọc filesystem:

| Endpoint | Mô tả |
|---|---|
| `GET /api/tasks` | Toàn bộ task: state + metadata artifact + nội dung `qa.md` |
| `GET /api/artifact?id=&name=` | Nội dung thô một artifact (markdown) |
| `GET /api/profile` | Profile flow orchestrator (đọc `orchestrator-profile.json` nếu có) |
| `POST /api/profile` | *(chưa triển khai)* — chỗ dành cho tính năng chỉnh flow từ UI |

## Định hướng tương lai (TBD)

Cho phép tùy chỉnh flow orchestrator qua profile trên UI và phản ánh trực tiếp khi vận hành. Hiện đã chừa endpoint `/api/profile` (GET hoạt động, POST trả 501) và file quy ước `.dev-team-agent/orchestrator-profile.json`. Khi triển khai: orchestrator đọc profile này ở đầu pipeline để bật/tắt bước, đổi ngưỡng `review_round`, hay mặc định `auto_review`.
