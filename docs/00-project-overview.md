# Asnova Payroll System — New Architecture

> **Status**: Planning  
> **Created**: 2026-05-29  
> **Goal**: Chuyển từ kiến trúc Lark Base-centric sang PostgreSQL + Web UI + Lark Sync

---

## 1. Tại sao cần kiến trúc mới?

### Vấn đề với hệ thống hiện tại

| # | Vấn đề | Impact |
|---|--------|--------|
| 1 | **Dữ liệu phân tán** trên ~15 Lark Base tables | Khó maintain, dễ bị inconsistent |
| 2 | **Tính toán trong Python scripts** thay vì DB | Bug khó tìm (VD: nghỉ KHL không trừ công) |
| 3 | **Không có audit trail** | Không biết ai sửa gì, khi nào |
| 4 | **API rate limit Lark** | Mỗi rollup mất 30-60s |
| 5 | **Không có UI quản trị** | C&B phải dùng trực tiếp Lark Base |
| 6 | **Không có transactional consistency** | Ghi field A thành công, field B fail → data lệch |

### Kiến trúc mới giải quyết gì?

- **PostgreSQL** = Single source of truth, tính toán bằng SQL
- **Web UI** = Giao diện nhẹ cho C&B team
- **Lark Base Sync** = Đồng bộ 2 chiều, Lark Base vẫn dùng để xem/report
- **Audit log** = Track mọi thay đổi

---

## 2. Tech Stack (Đề xuất)

| Layer | Công nghệ | Lý do |
|-------|-----------|-------|
| **Database** | PostgreSQL 16 (đã có trên VPS) | Sẵn có, mạnh, hỗ trợ JSON, full-text search |
| **Backend API** | Node.js / Express hoặc Python FastAPI | TBD — cần thảo luận |
| **Frontend** | Next.js hoặc Vite + React | TBD — cần thảo luận |
| **Lark Integration** | Lark Open API v3 | Giữ nguyên pattern hiện tại |
| **Hosting** | VPS hiện tại (61.14.233.201) | Đã có sẵn |

---

## 3. Documents

| File | Nội dung |
|------|----------|
| [01-current-system-analysis.md](./01-current-system-analysis.md) | Phân tích hệ thống hiện tại |
| [02-architecture-design.md](./02-architecture-design.md) | Kiến trúc hệ thống mới |
| [03-architecture-decisions.md](./03-architecture-decisions.md) | Quyết định công nghệ (confirmed) |
| [04-lark-field-types-analysis.md](./04-lark-field-types-analysis.md) | Lark Base field types — sync conflict avoidance |
| [05-calculation-engine.md](./05-calculation-engine.md) | Business logic & formulas trên platform |
| [06-full-solution.md](./06-full-solution.md) | **Full solution**: HR → Chấm công → Approval → OT → Chốt công → Lương → PDF |
| [07-implementation-checklist.md](./07-implementation-checklist.md) | **Checklist triển khai**: 10 phases, ~200 items |
| [08-api-design.md](./08-api-design.md) | API endpoints design |
| [09-ui-wireframes.md](./09-ui-wireframes.md) | UI wireframes & flows |

---

## 4. Phạm vi Phase 1

> **Mục tiêu**: MVP — Quản lý chấm công & tính lương với PostgreSQL, Web UI cơ bản, sync Lark

### In Scope
- [ ] Database schema cho: Employees, Attendance, Leave, Payroll
- [ ] API CRUD + business logic
- [ ] Web UI: Dashboard, Attendance, Payroll views
- [ ] Lark Base → PostgreSQL sync (one-way initially)
- [ ] PostgreSQL → Lark Base sync (push results back)

### Out of Scope (Phase 2+)
- OT ledger & approval workflow
- Payslip PDF generation
- Full Lark approval integration
- Night shift management
