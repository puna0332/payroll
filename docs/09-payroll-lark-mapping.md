# Payroll Lark Mapping

Source checked: `https://tsg3y8y89y0w.sg.larksuite.com/sheets/LwEashCNphYZVYtVyBSlhfnyg4d`, tab `Payroll 5.2026`.

Sheet manager checked: Base app `NYNlbfhByaFir7sOPPhl7FMEgkg`, table `tblFJ7kwfc1H0qFS`.

## Sheet Manager Records

| Record | Type | Month | Link field |
| --- | --- | --- | --- |
| `PAYROLL-SHEET-202605` | Bảng lương | 05/2026 | `Link Bảng lương` |
| `ATTENDANCE-SHEET-202605` | Bảng công | 05/2026 | `Link Bảng công` |
| `PAYROLL-SHEET-202606` | Bảng lương | 06/2026 | `Link Bảng lương` |
| `ATTENDANCE-SHEET-202606` | Bảng công | 06/2026 | `Link Bảng công` |

## Payroll Template Columns

| Col | Template field | App source |
| --- | --- | --- |
| B | Mã số NV / Staff code | `employee.employeeCode` |
| C | Họ và tên / Name | `employee.originalFullName` or `employee.fullName` |
| D | Chức vụ / Position | `employee.position` |
| E | Phân loại nh.viên / Staff classify | `employee.employmentType` |
| F | Ngày vào cty / 入社日 | `employee.joinDate` |
| G | 基本給 | `payslip.baseSalary` |
| I | Lương cơ bản / Basic salary | `payslip.baseSalary` |
| J | Phụ cấp cấp bậc / Position allowance | `fullBreakdown.allowances.rank` |
| K | Phụ cấp BPQL / Allowances for management dept | Always `0` in payroll calculation |
| L | Phụ cấp kinh doanh / Allowances for sales Tm | Always `0` in payroll calculation |
| M | Phụ cấp kỹ thuật / Technical allowance | `fullBreakdown.allowances.technical` |
| N | Phụ cấp ngoại ngữ / Foreign Language Allowance | `fullBreakdown.allowances.language` |
| O | Phụ cấp nhà ở / Apartment Allowance | `fullBreakdown.allowances.housing` |
| P | Phụ cấp đi lại / Commuting allowance | `fullBreakdown.allowances.transport` |
| Q | Phụ cấp ăn uống / Meal allowance | `fullBreakdown.allowances.meal` |
| R | Phụ cấp điện thoại / Telephone Allowance | `fullBreakdown.allowances.phone` |
| S | Phụ cấp chuyên cần / Attendance allowance | `fullBreakdown.allowances.attendance` |
| T | Tổng thu nhập / Total income | Sum of salary and monthly allowance columns |
| U | Lương tính công | Basic salary plus position allowance |
| V | Lương ngày | `U / standardDays` |
| W | Lương giờ | `V / 8`, rounded up to 10 VND |
| X:AC | OT salary buckets | Payable `otBucketBreakdown` only (`amount > 0`) and hourly multipliers; `Nghỉ bù` buckets are audit-only |
| AD | Số người phụ thuộc | `taxPolicyInfo.dependents` |
| AE | Số ngày chuẩn/tháng | `payslip.standardDays` |
| AF | Số ngày làm việc thực tế/tháng | `payslip.actualDays` |
| AJ | Vắng mặt | `attendance.absentDays` |
| AK | Về sớm, đi trễ | `attendance.lateHours + attendance.earlyHours` |
| AL:AQ | OT actual buckets | Payable `otBucketBreakdown` hours only (`amount > 0`) for salary template columns |
| AR | Trừ vắng mặt | `-daySalary * absentDays` |
| AS | Trừ đi trễ/về sớm | `-hourSalary * lateEarlyHours` |
| AU:AZ | OT money buckets | Bucket hours multiplied by bucket rates |
| BA | Trợ cấp trên số ngày công | Prorated allowances, including phone, minus allowance portion of late/early hours |
| BD | Tổng thu nhập | `payslip.grossIncome` |
| BE | OT PIT exemption | Total approved OT amount from payroll OT buckets |
| BF | Meal allowance exemption | `min(mealAllowance, 930000)` prorated |
| BG | Telephone allowance exemption | Prorated phone allowance |
| BH | Tổng thu nhập miễn thuế | `BE + BF + BG` |
| BI | Lương đóng BHXH,BHYT | Insurance basis capped at `46,800,000` |
| BJ | Lương đóng BHTN | Insurance basis capped at `99,200,000` |
| BK:BN | Employee insurance | Social, medical, unemployment, total |
| BO | Giảm trừ gia cảnh | Personal plus dependent deductions |
| BP | Thu nhập tính thuế | `gross - totalTaxExempt - insuranceEmployee - familyDeduction` (`P` type skips family deduction per template) |
| BQ | Thuế TNCN | Progressive PIT using template brackets: 5% up to 10M, 10% to 30M, 20% to 60M, 30% to 100M, 35% above 100M |
| BR | Điều chỉnh sau thuế | `payslip.afterTaxAdjustment` |
| BS | Lương thực nhận | `payslip.netSalary` |
| BT:BX | Company insurance | Employer insurance and total company/staff cost |

## Formula Alignment Notes

- Database → Lark Base outbound sync is implemented in `packages/api/src/modules/sync/sync-outbound.ts`. It writes PostgreSQL-calculated snapshots back to Lark Base tables for monthly attendance, OT monthly ledger, OT detail rows, leave balances, and payslip rows, while fetching Lark field schema first and skipping formula/lookup/auto/reverse-link fields.
- Manual trigger: `POST /api/sync/outbound/:periodId` with body `{ "type": "all" }` or one of `attendance`, `ot`, `leave`, `payslips`. A successful May 2026 verification returned attendance `16`, OT ledger `7`, OT details `62`, leave `16`, payslips `17`, all with `errors: 0`.
- Close-period step `outbound_sync_lark` now calls the same sync function, so closing a period uses the same database-to-Lark mapping as manual sync.
- Template columns `K` and `L` are formula participants through `SUM(I:S)`, so the API calculator normalizes `bpql` and `sales` to `0` before gross, PIT, net salary, and `fullBreakdown` are saved.
- Local workbook `/Users/khanguyen/Downloads/Mẫu file salary 2025(cập nhật 4.2026).xlsx`, tab `Payroll 4.2026`, confirms the normalized 2026 payroll formulas: meal tax exemption cap `930,000`, personal deduction `15,500,000`, dependent deduction `6,200,000`, total tax exemption `BE+BF+BG`, and net salary `ROUND(BD-BN-BQ+BR,-2)`.
- The API stores `fullBreakdown.taxExemptions` so UI tooltips and Lark export explain the same business calculation used for PIT.
- The payroll page must read salary values from payslips, not directly from salary policy, because payslips contain the normalized calculation snapshot.
- Sheet manager records distinguish `Bảng lương` and `Bảng công`; payroll exports should use the `Link Bảng lương` record for the selected month, while timesheet exports use `Link Bảng công`.
- OT payroll amount is policy-aware: approved OT forms with `Chính sách OT = Nghỉ bù` keep their approved hours in `ot_details` / `ot_monthlies` for audit and UI visibility, but all OT bucket amounts are saved as `0`; only `Chính sách OT = Tính lương OT` contributes to columns `AU:AZ`, `BE`, `BD`, and net salary.
- Payroll salary UI/export separate approved OT audit hours from payable OT hours: salary columns `X:AC`, `AL:AQ`, `AU:AZ`, KPI OT totals, and export totals include only buckets whose `amount > 0`. Comp-leave OT remains visible in formula tooltips as `OT nghỉ bù/không chi trả` so ASV010 keeps 50h audit evidence but displays `0h` payable OT, while ASV022 still displays 32h payable OT and `6,937,500` VND.
- Compensatory leave is credited from approved `Change working & holidays hour` / `休日変更` forms, not directly from the OT form. The worked source interval proves the comp-leave entitlement, while the compensated leave interval(s) are added to `monthly_attendances.compLeaveHours` and `paidCreditHours`, so those approved absence windows count as paid workdays.
- Approval detail API links `Chính sách OT = Nghỉ bù` OT forms to matching `休日変更` records by comparing the OT worked window with the worked source interval in the change-hours form. Example: ASV010 OT `202605030001` (`22:00 03/05/2026~06:00 04/05/2026`, 8h) links to change-hours forms `202605040003` (`08:00~12:00 04/05/2026`, 4h nghỉ bù) and `202605050003` (`13:00~17:00 05/05/2026`, 4h nghỉ bù).
- When month calendar records are missing, monthly attendance fallback now derives standard days from the payroll period, schedule type, and Vietnamese holidays: May 2026 resolves to `25` standard days for `OFFICE` and `29` for `SIX_DAY`.
- BOD expatriate staff (`employmentType = M`, e.g. ASV001/ASV013) are excluded from employee/employer insurance and PIT in the payroll snapshot, matching the company template treatment for management/expat payroll rows.
