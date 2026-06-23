# ASNOVA Payroll

ASNOVA Payroll là nền tảng quản lý chấm công, phê duyệt, tăng ca và bảng lương cho ASNOVA Việt Nam. Hệ thống đồng bộ dữ liệu từ Lark, chuẩn hóa dữ liệu nhân sự, tính công theo kỳ lương, tính OT theo từng bucket, tính bảo hiểm, thuế TNCN và xuất bảng lương đúng template nội bộ.

## Tính Năng Chính

- **Quản lý nhân sự**: thông tin nhân sự, mã nhân viên, phòng ban, chức vụ, loại nhân viên, avatar và trạng thái làm việc.
- **Chấm công theo kỳ lương**: xem tổng công tháng, công thực tế, đi trễ, về sớm, phép đã dùng, ngày vắng và các ngày được bù công.
- **Phiếu phê duyệt từ Lark**: đồng bộ nghỉ phép, nghỉ có lương, nghỉ trừ lương, OT và đổi giờ/ngày làm việc.
- **Tính OT thực tế**: lấy giờ được duyệt trên phiếu OT, phân loại theo bucket và tách phần nghỉ bù/OT trả lương.
- **Bảng lương chuẩn hóa**: tính lương cơ bản, phụ cấp, lương theo công, OT, bảo hiểm, thuế TNCN, miễn thuế và lương thực nhận.
- **Đồng bộ Lark Sheet**: xuất và cập nhật sheet tính công, sheet OT và bảng lương theo đúng template vận hành.
- **Theo dõi chỉnh sửa**: lưu audit log cho các thay đổi thông tin nhân sự, chính sách lương, bảo hiểm, thuế và chỉnh tay bảng lương.

## Công Nghệ

| Lớp | Công nghệ |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4, Framer Motion, Lucide |
| Backend | Node.js 20, Express, TypeScript, Prisma |
| Database | PostgreSQL |
| Tích hợp | Lark Open Platform, Lark Base, Lark Sheet |
| Deploy | VPS Ubuntu, Nginx, systemd, Cloudflare DNS/Proxy |

## Cấu Trúc Dự Án

```text
asnova-payroll/
├── docs/                  # Tài liệu phân tích, mapping, checklist triển khai
├── packages/
│   ├── api/               # Backend API, Prisma schema, payroll engine
│   └── web/               # Frontend SPA
├── scripts/               # Script đồng bộ, kiểm tra và vận hành
├── docker-compose.yml     # Cấu hình tham khảo cho môi trường container
└── package.json           # npm workspaces root
```

## Chạy Local

```bash
npm install

cp packages/api/.env.example packages/api/.env
# Cập nhật DATABASE_URL và thông tin Lark trong packages/api/.env

npm run db:generate
npm run build:api
npm run build:web

npm run dev:api   # API: http://localhost:3100
npm run dev:web   # Web: http://localhost:3101
```

## Biến Môi Trường

Các biến nhạy cảm không được commit lên GitHub. Tạo file `packages/api/.env` trên từng môi trường triển khai:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/asnova_payroll?schema=public"
LARK_APP_ID="cli_xxxxxxxxxxxxx"
LARK_APP_SECRET="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
LARK_APP_TOKEN="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
PORT=3100
NODE_ENV=production
```

## Lệnh Kiểm Tra

```bash
npm run build:api
npm run build:web
```

## Tài Liệu Quan Trọng

| Tài liệu | Nội dung |
| --- | --- |
| [Tổng quan dự án](./docs/00-project-overview.md) | Mục tiêu, phạm vi và kiến trúc tổng quan |
| [Giải pháp đầy đủ](./docs/06-full-solution.md) | Luồng end-to-end từ Lark đến payroll |
| [Checklist triển khai](./docs/07-implementation-checklist.md) | Trạng thái triển khai và các hạng mục còn lại |
| [Mapping bảng lương Lark](./docs/09-payroll-lark-mapping.md) | Mapping dữ liệu platform sang template Lark Sheet |

## Domain Production

Ứng dụng production được public qua Cloudflare tại:

- `https://asnova.mindtheoperation.com`

