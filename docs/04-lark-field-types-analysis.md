# Lark Base Field Types — Sync Conflict Avoidance

> **Mục đích**: Xác định field nào trên Lark Base là Formula/Lookup → outbound sync SKIP các field này  
> **Nguyên tắc quan trọng**: Platform của chúng ta (PostgreSQL + Node.js) **tính toán TẤT CẢ logic/formula độc lập**. Lark Base chỉ là view layer.  
> **Ngày kiểm tra**: 2026-05-29

---

## Nguyên tắc 2 lớp tính toán

```
┌──────────────────────────────────────────────────────────────────┐
│  PLATFORM CỦA CHÚNG TA (Source of Truth)                        │
│                                                                  │
│  PostgreSQL + Node.js                                            │
│  ├─ Tính toán TẤT CẢ formulas: lương/ngày, BH, công chuẩn...   │
│  ├─ Lưu KẾT QUẢ đầy đủ vào DB                                  │
│  └─ Business logic 100% chạy trên platform này                  │
│                                                                  │
│  Frontend (Vite + React)                                         │
│  ├─ Hiển thị TẤT CẢ giá trị (bao gồm computed fields)          │
│  ├─ Edit input fields → backend recalculate → save              │
│  └─ Không phụ thuộc Lark Base cho bất kỳ tính toán nào         │
└──────────────────────────────────────────────────────────────────┘
                           │
                     Outbound Sync
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  LARK BASE (View Layer — Read-Only)                              │
│                                                                  │
│  ├─ Nhận data từ PostgreSQL qua API                              │
│  ├─ WRITABLE fields: nhận giá trị từ sync                       │
│  ├─ FORMULA fields: Lark tự tính lại (chúng ta SKIP khi sync)  │
│  └─ C&B team xem/report — KHÔNG edit trên Lark                  │
└──────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Tài liệu này CHỈ phục vụ việc outbound sync** — biết field nào cần skip để không bị error.
> **Tất cả logic tính toán** nằm trong doc [05-calculation-engine.md](./05-calculation-engine.md).

---

## Tóm tắt nhanh

### Read-Only Field Types (KHÔNG write được từ API)

| Type Code | Tên | Hành vi |
|-----------|-----|---------|
| `20` | **FORMULA** | Lark tự tính từ các field khác — write sẽ bị ignore hoặc error |
| `21` | **LOOKUP** | Giá trị nhìn qua link — auto-populated từ linked record |
| `22` | **Auto Serial** | Auto-increment — Lark tự gán |
| `23` | **Created Time** | Timestamp tạo record — auto |
| `24` | **Modified Time** | Timestamp sửa record — auto |
| `1001` | **Created User** | Ai tạo — auto |
| `1002` | **Modified User** | Ai sửa — auto |

### Writable Field Types

| Type Code | Tên |
|-----------|-----|
| `1` | Text |
| `2` | Number |
| `3` | Single Select |
| `4` | Multi Select |
| `5` | Date/DateTime |
| `7` | Checkbox |
| `11` | User (person) |
| `13` | Phone |
| `15` | URL |
| `17` | Attachment |
| `18` | Link (record link — writable, cần record_id) |
| `19` | Lookup Reference (writable source side of link) |

---

## Chi tiết Formula Fields theo Table

### 1. Thông tin lương, phúc lợi (`tblRTOr2MmfemvO7`) — 2 Formula

| Field | Type | Formula | Ý nghĩa |
|-------|------|---------|----------|
| **Lương theo ngày** | ❌ FORMULA | `Lương / Số ngày làm việc trong tháng` | Auto-calc từ lương & công chuẩn |
| **Lương theo giờ** | ❌ FORMULA | `Lương theo ngày / 8` | Auto-calc từ lương theo ngày |

> **Sync strategy**: Chỉ write `Lương`, `Tỷ lệ`, `Số ngày làm việc trong tháng` → Lark tự tính `Lương theo ngày` và `Lương theo giờ`

---

### 2. BHXH, BHYT, BHTN (`tblkKgPs4299uRUU`) — 9 Formula

| Field | Type | Formula Logic | Ý nghĩa |
|-------|------|--------------|----------|
| **BHXH (8%)** | ❌ FORMULA | `Lương offer × Tỷ lệ BHXH NLĐ` | BH xã hội nhân viên |
| **BHYT (1.5%)** | ❌ FORMULA | `Lương offer × Tỷ lệ BHYT NLĐ` | BH y tế nhân viên |
| **BHTN (1%)** | ❌ FORMULA | `Lương offer × Tỷ lệ BHTN NLĐ` | BH thất nghiệp nhân viên |
| **BHXH (17.5%)** | ❌ FORMULA | `Lương offer × Tỷ lệ BHXH DN` | BH xã hội doanh nghiệp |
| **BHYT DN (3%)** | ❌ FORMULA | `Lương offer × Tỷ lệ BHYT DN` | BH y tế doanh nghiệp |
| **BHTN DN (1%)** | ❌ FORMULA | `Lương offer × Tỷ lệ BHTN DN` | BH thất nghiệp doanh nghiệp |
| **Tổng cộng BH NLĐ** | ❌ FORMULA | `BHXH 8% + BHYT 1.5% + BHTN 1%` | Tổng BH nhân viên đóng |
| **Tổng cộng BH DN** | ❌ FORMULA | `BHXH 17.5% + BHYT DN 3% + BHTN DN 1%` | Tổng BH doanh nghiệp đóng |
| **Tổng chi phí BH** | ❌ FORMULA | `Tổng BH NLĐ + Tổng BH DN` | Grand total |

> **Sync strategy**: Chỉ write `Lương offer`, các `Tỷ lệ %` → Lark tự tính tất cả 9 fields.
> **Tuy nhiên**: Table có cả `snapshot` fields (WRITABLE) — `BHXH NLĐ snapshot`, `BHYT NLĐ snapshot`, v.v. — đây là nơi Python code hiện tại write kết quả tính toán.

---

### 3. Quy tắc nghỉ (`tbl2GdNlYQfiySFD`) — 2 Formula

| Field | Type | Formula Logic | Ý nghĩa |
|-------|------|--------------|----------|
| **Công chuẩn phải làm** | ❌ FORMULA | `IF(Văn phòng, Ngày trong tháng − T7 − CN − Lễ, Ngày − CN − Lễ)` | Công chuẩn theo schedule type |
| **Số ngày làm việc trong tháng** | ❌ FORMULA | `Ngày trong tháng − Lễ/đặc biệt` | Ngày làm việc thực tế |

> **Sync strategy**: Chỉ write `Số ngày trong tháng`, `Số thứ 7`, `Số chủ nhật`, `Số ngày lễ` → Lark tự tính `Công chuẩn phải làm`

---

## Lookup Fields (Read-Only — Auto từ Link)

Mỗi table có nhiều LOOKUP fields bắt đầu bằng `↔`. Đây là **reverse lookup** — tự động hiển thị linked records. **KHÔNG cần write**, Lark tự cập nhật khi link thay đổi.

### Tổng hợp Lookup Fields

| Table | Số Lookup | Ví dụ |
|-------|-----------|-------|
| Danh sách nhân sự | 10 | ↔ Thông tin lương, ↔ BHXH, ↔ Bảng công, ↔ Phiếu lương, ... |
| Đồng bộ chấm công | 4 | ↔ Phiếu nghỉ/chỉnh công, ↔ Chi tiết OT, ... |
| Bảng công tháng TL | 5 | ↔ Sổ cái OT, ↔ Quy tắc nghỉ, ↔ Lịch chốt công, ... |
| Phiếu phê duyệt | 5 | ↔ Dữ liệu chấm công, ↔ Chi tiết OT, ... |
| Chi tiết OT | 4 | ↔ Phiếu phê duyệt, ↔ Chấm công, ... |
| Sổ cái OT tháng | 4 | ↔ Phiếu lương, ↔ Chi tiết OT, ↔ Bảng công, ... |
| Phiếu lương | 3 | ↔ Sổ cái OT, ↔ Danh sách nhân sự, ↔ Lịch chốt công |
| Lịch chốt công | 5 | ↔ Bảng công, ↔ Sheet, ↔ Phiếu lương, ... |
| Quy tắc nghỉ | 1 | ↔ Bảng công tháng TL |
| Tồn phép năm | 2 | ↔ Danh sách nhân sự, Phiếu lương tham chiếu |

---

## Sync Rules cho PostgreSQL → Lark Base

### Rule 1: SKIP Formula & Lookup Fields

```typescript
// Trong outbound sync, SKIP các field types này:
const READ_ONLY_TYPES = new Set([20, 21, 22, 23, 24, 1001, 1002]);

// Khi build payload cho batch_update:
function buildLarkPayload(record: Record<string, any>, fieldSchema: FieldSchema[]): Record<string, any> {
  const payload: Record<string, any> = {};
  for (const field of fieldSchema) {
    if (READ_ONLY_TYPES.has(field.type)) continue; // Skip formula/lookup
    if (record[field.dbColumn] !== undefined) {
      payload[field.larkFieldName] = record[field.dbColumn];
    }
  }
  return payload;
}
```

### Rule 2: Write INPUT Fields → Formula Tự Tính

| Muốn cập nhật | Write vào (Input) | Lark tự tính (Formula) |
|----------------|-------------------|------------------------|
| Lương theo ngày/giờ | `Lương` + `Số ngày làm việc` | `Lương theo ngày`, `Lương theo giờ` |
| Số tiền BH | `Lương offer` + `Tỷ lệ %` | 9 formula BH fields |
| Công chuẩn | `Số ngày trong tháng` + `T7` + `CN` + `Lễ` | `Công chuẩn phải làm` |

### Rule 3: Link Fields = Writable nhưng cần Record ID

```typescript
// Link fields (type 18) CẦN Lark record_id:
payload["↔ Danh sách nhân sự"] = [{ record_id: "recXXX" }];
// Hoặc dạng link_record_ids:
payload["↔ Lịch chốt công"] = [{ link_record_ids: ["recYYY"] }];
```

> ⚠️ **PostgreSQL phải lưu `lark_record_id`** cho mỗi entity để có thể tạo link khi sync.

### Rule 4: Frontend Display All, Edit Only Writable

```
┌─ Frontend Attendance View ────────────────────────────────┐
│                                                            │
│  Công chuẩn:        25 ngày     ← WRITABLE (editable)     │
│  Công thực tế:      22 ngày     ← WRITABLE (editable)     │
│  Giờ làm thực tế:   176h        ← WRITABLE (editable)     │
│  Lương theo ngày:   500,000đ    ← FORMULA (display-only)  │
│  Lương theo giờ:    62,500đ     ← FORMULA (display-only)  │
│  BHXH (8%):         960,000đ    ← FORMULA (display-only)  │
│                                                            │
│  [💾 Save] → PostgreSQL → Lark Base (skip formula fields)  │
└────────────────────────────────────────────────────────────┘
```

---

## Tổng kết: 13 Formula Fields cần xử lý

| # | Table | Field | Strategy |
|---|-------|-------|----------|
| 1 | Thông tin lương | Lương theo ngày | Display-only, Lark auto-calc |
| 2 | Thông tin lương | Lương theo giờ | Display-only, Lark auto-calc |
| 3 | BHXH | BHXH (8%) | Display-only, Lark auto-calc |
| 4 | BHXH | BHYT (1.5%) | Display-only, Lark auto-calc |
| 5 | BHXH | BHTN (1%) | Display-only, Lark auto-calc |
| 6 | BHXH | BHXH (17.5%) | Display-only, Lark auto-calc |
| 7 | BHXH | BHYT DN (3%) | Display-only, Lark auto-calc |
| 8 | BHXH | BHTN DN (1%) | Display-only, Lark auto-calc |
| 9 | BHXH | Tổng BH NLĐ | Display-only, Lark auto-calc |
| 10 | BHXH | Tổng BH DN | Display-only, Lark auto-calc |
| 11 | BHXH | Tổng chi phí BH | Display-only, Lark auto-calc |
| 12 | Quy tắc nghỉ | Công chuẩn phải làm | Display-only, Lark auto-calc |
| 13 | Quy tắc nghỉ | Số ngày làm việc trong tháng | Display-only, Lark auto-calc |

> [!IMPORTANT]
> **Trong PostgreSQL**: Tất cả 13 formula fields này vẫn được **tính và lưu** trong DB (vì DB là source of truth). Chỉ khi **outbound sync → Lark Base** thì SKIP không ghi vào formula fields — Lark sẽ tự tính lại từ input fields.

> [!TIP]
> **BHXH table có snapshot fields**: `BHXH NLĐ snapshot`, `Tổng BH NLĐ snapshot`, v.v. — đây là WRITABLE number fields. Python code hiện tại write kết quả tính toán vào đây. Có thể dùng snapshot fields thay vì formula fields để push data.
