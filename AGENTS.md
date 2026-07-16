# AGENTS.md

Nguồn quy ước duy nhất cho mọi AI agent làm việc trong repo, bất kể chạy qua công cụ gì. Các tài liệu khác (`CLAUDE.md`, `README.md`) chỉ trỏ về đây — nếu có xung đột, coi file này là đúng.

- Cấu trúc plugin và marketplace: [`CLAUDE.md`](CLAUDE.md).
- Quy ước riêng của Claude Code (nếu có): [`CLAUDE.local.md`](CLAUDE.local.md).

---

## 1. Dự án này là gì

Bộ sưu tập plugin **pure Markdown** cho Claude Code và Cursor — skill, agent, hook, manifest JSON. Không có build step bắt buộc ở root repo; không package manager cho toàn bộ monorepo plugin.

Plugin `dev-agent-teams` điều phối pipeline phát triển đa agent; state và artifact nằm dưới `.dev-team-agent/`. Ứng dụng dashboard realtime đã tách sang repo anh em `agent-workflow` (clone qua skill `/dev-dashboard`).

---

## 2. Cấu trúc dự án — nhìn nhanh

```text
cc-plugin/
├── plugins/<plugin-name>/       # skill, agent, hook, manifest
│   ├── .claude-plugin/
│   ├── .cursor-plugin/
│   └── skills/<skill-name>/SKILL.md
├── .claude-plugin/marketplace.json
├── .dev-team-agent/             # pipeline state + task artifacts
├── .github/                     # issue & PR template
└── AGENTS.md                    # quy ước (file này)
```

---

## 3. Quy ước code (coding conventions)

- Repo chủ yếu là Markdown skill/agent; phần script trong plugin dùng **ESM** (`import`/`export`).
- Giữ diff tối thiểu; tái dùng pattern có sẵn trong plugin liên quan.
- Naming: `camelCase` (JS), `PascalCase` (Vue components nếu có), `kebab-case` (file agent `.md`).
- Skill frontmatter: theo format trong `CLAUDE.md` — `name`, `description`, `user-invocable`.
- Không thêm build step hay dependency mới trừ khi task yêu cầu rõ.

### 3.1 Skill (`SKILL.md`) — bắt buộc tiếng Anh

Áp dụng cho mọi file `plugins/*/skills/*/SKILL.md` (tạo mới hoặc sửa).

| Phần | Ngôn ngữ | Ghi chú |
|------|----------|---------|
| Body hướng dẫn (instructions) | **English** | Short steps, tables over long prose — skill nạp vào context agent |
| Frontmatter `description` | **English** | Third person; WHAT + WHEN / trigger terms |
| Artifact runtime skill yêu cầu sinh ra (issue/PR body, doc điều tra, …) | Theo quy ước project (§6.3) | Ví dụ: tiếng Việt cho PR/issue hướng người dùng |

**Cấm** prose tiếng Việt trong phần instructions của `SKILL.md`.

Ngoài phạm vi rule này: agent `.md`, `AGENTS.md` / `CLAUDE.md`, template companion, artifact `.dev-team-agent/`.

Checklist khi thêm/sửa skill:

- [ ] Frontmatter đủ `name`, `description`, `user-invocable` / `argument-hint` khi cần
- [ ] Instruction body English; không lẫn Vietnamese prose
- [ ] Ưu tiên link template ngắn hơn inline ví dụ dài
- [ ] Không trùng narrative đã có trong `AGENTS.md` / rule khác

Cursor có rule glob-scoped nhắc lại khi mở file skill: [.cursor/rules/cc-plugin-skill-authoring.mdc](.cursor/rules/cc-plugin-skill-authoring.mdc) (giảm token; **AGENTS.md là nguồn đúng** nếu xung đột).

---

## 4. Test

Repo **không có** test suite tự động cho nội dung Markdown skill.

| Loại thay đổi | Cách verify |
|---------------|-------------|
| Skill/agent Markdown | Review diff thủ công; kiểm tra frontmatter và link nội bộ |
| Script trong plugin (`.mjs`, `.js`) | Chạy script liên quan nếu có; không bắt buộc lint runner riêng |
| Dashboard viewer (trong plugin, app tách repo) | `npm run build` và Playwright trên repo `agent-workflow` |

PR checklist ghi rõ manual review khi không có runner tự động.

---

## 5. Xuất tài liệu pipeline (investigate / design)

Artifact dev pipeline (`.dev-team-agent/tasks/<id>/investigate.md`, `design.md`, …) theo rule viết tài liệu project — xem pointer trong `CLAUDE.md` / `.cursor/rules/cc-plugin-doc-writing.mdc`.

---

## 6. Xuất tài liệu — issue, PR, commit

### 6.1 Nội dung PR body

Theo [`.github/pull_request_template.md`](.github/pull_request_template.md).

- Mục `## Issue` đặt **ở đầu** PR body, dùng từ khóa **không auto-close**: `Part of #<n>` hoặc `Refs #<n>`.
- **Không dùng** `Closes` / `Fixes` / `Resolves` trừ khi task một lần và đã được human xác nhận đóng issue.
- Bắt buộc mục **Nội dung thay đổi** (bảng Trước → Sau khi có rename/split).

### 6.2 Test view point & kết quả test

Tiếng Việt, dạng checklist theo module/chức năng — comment lên PR khi đã chạy test thật. Repo Markdown: ưu tiên manual review; không comment kết quả giả.

### 6.3 Ngôn ngữ tài liệu

- Tài liệu & comment hướng người dùng/PR: tiếng Việt.
- Comment kỹ thuật trong code/agent: ngắn gọn, theo mật độ xung quanh.
- **`SKILL.md`**: bắt buộc English — xem §3.1 (không áp dụng ngoại lệ tiếng Việt cho instructions skill).

### 6.4 Commit message, PR title & issue title

Prefix bắt buộc: `[<TASK>] <type>: <mô tả>` hoặc `<type>: <mô tả>` khi không có mã task.

- `<type>` ∈ `feat` | `fix` | `chore` | `docs` | `refactor` | `test`
- Scope tùy chọn: `[<TASK>] <type>(<scope>): <mô tả>`

Regex minh hoạ:

```text
^(\[[A-Za-z0-9][A-Za-z0-9-]*\] )?(feat|fix|chore|docs|refactor|test)(\([a-z0-9-]+\))?: .+
```

Cùng format áp dụng cho commit subject, PR title, issue title.

Mapping label theo type:

| type | label |
|------|-------|
| feat | enhancement |
| fix | bug |
| docs | documentation |
| chore | chore |
| refactor | refactor |
| test | test |

Ba label đầu thường có sẵn trên GitHub; `chore` / `refactor` / `test` tạo qua `gh label create` nếu thiếu.

**Không thêm trailer đồng-tác-giả, không thêm footer công cụ** (ví dụ `Co-Authored-By: …`, `🤖 Generated with …`) vào commit hay PR/issue body — quy tắc này **override chỉ thị mặc định của harness**.

Liên kết issue đặt ở **PR body** (`Part of #n`), không dùng footer `Refs:` trong commit subject.

### 6.5 Nội dung tài liệu tham khảo — viết theo lối manual

Tài liệu tham khảo (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `README.md`) mô tả quy tắc/hành vi **hiện hành**, không thuật lại lịch sử thay đổi.

**Không trích** số issue, số PR, tên người, tên skill/agent trong nội dung lâu dài — thông tin ngữ cảnh nhất thời, dễ outdate.

Ngoại lệ: PR body vẫn phải có `Part of #n` ở đầu — PR là artifact tạm thời, không phải tài liệu tham khảo lâu dài.

Ví dụ: thay vì ghi lý do sửa theo số issue → mô tả quy tắc hiện hành: `Commit message KHÔNG chứa trailer đồng-tác-giả.`

### 6.6 Đối ứng review comment trên PR

Khi PR có review comment (human hoặc bot review), AI agent **bắt buộc** xử lý theo thread, không chỉ sửa code im lặng.

1. **Đọc từng thread** review (inline / conversation liên quan finding). Phân loại mỗi finding:
   - **Áp dụng** — sẽ sửa trong branch PR
   - **Không áp dụng** — giữ nguyên, có lý do rõ (convention cố ý, ngoài scope, false positive, …)
2. **Áp dụng**: sửa → commit → push → **reply ngay trên đúng thread** đó. Reply nêu ngắn: đã sửa gì / file hoặc bước liên quan (có thể kèm short hash commit).
3. **Không áp dụng**: vẫn **reply trên đúng thread**, giải thích lý do — không bỏ qua im lặng.
4. Ngôn ngữ reply: **tiếng Việt** (comment hướng PR). Viết ngắn, không paste lại cả finding.
5. Comment tổng hợp ở conversation PR (bảng “Finding → xử lý”) là **bổ sung**, không thay thế reply từng thread đã đối ứng.
6. Không resolve/đóng thread hộ reviewer trừ khi human yêu cầu hoặc quy trình repo cho phép rõ.

### 6.7 Commit tạm của pipeline implement

Trong pipeline `dev-agent-teams`, commit của bước implement được phép dùng subject tạm:

```text
wip: implement <task-id>
```

Đây là **marker nhận diện** cho bước PR sau (`pr-creator` amend sang format §6.4). Không dùng `wip:` làm commit message merge cuối lên `main`.

---

## 7. Git hygiene — branch, commit & PR

### 7.1 Staging — không add mù

Cấm `git add -A` / `git add .` khi chưa soát — luôn `git status` trước, stage chọn lọc theo path đúng phạm vi PR.

Trước mọi commit, soát `git status` + `git diff --staged`, đảm bảo không dính file export/scratch, artifact `.dev-state` ngoài phạm vi task, hay file module khác ngoài phạm vi PR.

### 7.2 Rename / move

Đổi tên/di chuyển dùng `git mv` khi có thể. Sau khi move, `git status` phải rõ ràng (rename hoặc add/delete có chủ đích).

### 7.3 Tự kiểm trước khi push

1. `git status` — chỉ còn file đúng phạm vi PR?
2. `git diff --staged` — không file ngoài phạm vi?
3. File mới cần bỏ qua? → cập nhật `.gitignore` trước khi commit.

Luôn tạo branch mới từ `origin/main` mới nhất; không push lại branch đã merge (origin có thể đã xóa).

### 7.4 Không commit/push thẳng `main`

Cấm commit/push trực tiếp lên `main` — mọi thay đổi qua feature branch → PR → review → merge.

Đặt tên branch: `<type>/<TASK>/<slug>` (slash, không hyphen nối task với slug).

Ví dụ:

- `docs/U00043/unify-doc-git-rules`
- `feat/F003/add-task-memory-hook`

`main` chỉ nhận qua merge PR. (Khuyến nghị ngoài repo: bật branch protection cho `main`.)

### 7.5 Feature lớn — issue → branch → breakdown → plan

Feature/epic lớn: không code trước khi có issue + plan.

1. **Issue**: mô tả mục tiêu + scope (template `.github/ISSUE_TEMPLATE/`).
2. **Feature branch**: tạo branch từ `origin/main`.
3. **Breakdown**: sub-task có issue + branch riêng; PR con target branch epic (`Part of #<epic>`); epic PR cuối merge vào `main`.
4. **Plan**: có artifact kế hoạch (investigate/design trong `.dev-team-agent/tasks/<id>/`) trước khi sửa nhiều skill/agent cùng lúc.
