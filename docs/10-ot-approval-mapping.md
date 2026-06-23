# OT Approval Mapping

Nguồn chuẩn cho bucket/rate/giờ tính lương OT là phiếu phê duyệt Lark, có thể đối chiếu với `ot_details` khi kỳ lương đã rebuild. UI Approvals, `ot_details`, `ot_monthlies`, payslip và export payroll đều tính giờ/tiền theo số giờ được duyệt trên phiếu để HR nhìn đúng request đã approved.

## Công Thức Chung

- `approvedHours`: giờ trên phiếu Lark, là giờ dùng để hiển thị, tổng hợp tháng, tính payslip, export và tính tiền tại UI Approvals.
- `validHours`: giờ thực tế overlap giữa khung OT được duyệt và check-in/check-out thực tế, chỉ dùng để đối chiếu/audit, không dùng để tính lương OT.
- `hourlyRate`: lương tiêu chuẩn theo giờ từ `salary_policies`.
- `otHourlyRate`: `hourlyRate * rate`, làm tròn lên VND.
- `amount`: `ceil(approvedHours * rate * hourlyRate)`.

Nếu chưa có `ot_details`, API Approvals vẫn parse bucket theo khung duyệt và tính `effectiveHours` theo `approvedHours`.

## Payroll Calculation

Pipeline tính lương OT dùng chung một rule:

- `rebuildOtDetailsFromApprovals`: ghi `hours = approvedHours`, giữ `validHours` để audit, và tính `amount = ceil(approvedHours * rate * hourlyRate)`.
- `aggregateOtMonthly`: tổng hợp `totalHours` từ `ot_details.hours` và `totalAmount` từ `ot_details.amount`.
- `calculatePayslip`: đọc `ot_monthlies.totalHours/totalAmount` để đưa vào payslip.
- Payroll UI/export: hiển thị và ghi sheet theo cùng `approvedHours/amount`, không lấy lại `validHours`.

## Bucket Mapping

| Bucket trong hệ thống | Điều kiện | Hệ số | Nhóm bảng lương | Cột giờ trong payroll export | Cột tiền trong payroll export |
| --- | --- | ---: | --- | --- | --- |
| `Ngày thường 時間外 17h~22h` | Ngày thường, 06:00-22:00 | 1.5 | OT ngày thường | `AL` | `AU` |
| `Ngày thường 時間外(夜間まで残業) 22h~6h` | Ngày thường, 22:00-06:00 | 2.1 | Làm thêm đến đêm | `AO` | `AX` |
| `平日の夜勤 22h~6h ca đêm` | Ca đêm cố định, 22:00-06:00 | 0.3 | Làm ca đêm ngày thường | `AP` | `AY` |
| `平日夜勤の残業→翌日の6h~22h Số giờ làm thêm của ca đêm` | OT sau ca đêm, 06:00-22:00 | 1.5 | OT ngày thường | `AL` | `AU` |
| `Ngày nghỉ T7 休日出勤(土) 6h~22h` | Thứ 7 nghỉ, 06:00-22:00 | 1.5 | Làm ngày nghỉ | `AM` | `AV` |
| `Ngày nghỉ 休日出勤 6h~22h` | Ngày nghỉ/CN, 06:00-22:00 | 2.0 | Làm ngày nghỉ | `AM` | `AV` |
| `OT ngày lễ 祝日出勤` | Ngày lễ, 06:00-22:00 | 3.0 | Làm ngày lễ | `AN` | `AW` |
| `Ngày nghỉ T7 ca đêm 土曜夜勤 22h~6h` | Thứ 7 nghỉ, 22:00-06:00 | 2.7 | Làm ca đêm ngày nghỉ | `AQ` | `AZ` |
| `Ngày nghỉ ca đêm 休日の夜勤 22h~6h` | Ngày nghỉ/CN, 22:00-06:00 | 2.7 | Làm ca đêm ngày nghỉ | `AQ` | `AZ` |
| `OT ngày lễ ca đêm 祝日夜勤 22h~6h` | Ngày lễ, 22:00-06:00 | 3.9 | Làm ca đêm ngày nghỉ/lễ | `AQ` | `AZ` |

## UI Approvals

`GET /api/approvals` và `GET /api/approvals/:id` trả:

- `otSegments[]`: từng phân khúc OT, gồm bucket, label, rate, approvedHours, validHours, effectiveHours, hourlyRate, otHourlyRate, amount, startTime, endTime.
- `otSummary`: tổng `hours`, `amount`, `approvedHours`.

Frontend chỉ render các field này. `effectiveHours` hiện bằng giờ duyệt trên phiếu, còn `validHours` dùng như dữ liệu đối chiếu khi cần audit chấm công.
