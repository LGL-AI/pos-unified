# Echo Coffee · Lotus POS Unified 2.6.0-rc.3

Ngày cập nhật: 25/09/2026. Đây là mã nguồn cho npm local; chưa triển khai Worker/D1 thật, chưa in kiểm chứng trên thiết bị tại quán.

## Theo phản hồi mới

1. Giỏ QR cho khách chọn **chuyển khoản** hoặc **tiền mặt** trước nút “Xác nhận gọi món”. Lựa chọn được lưu cùng đơn trên D1. Với tiền mặt, sau khi Worker xác nhận tạo đơn, giao diện gửi yêu cầu nhân viên đến bàn qua API và hiện “Xin cảm ơn quý khách, nhân viên sẽ tới bàn phục vụ quý khách ngay bây giờ.” **chỉ sau khi yêu cầu phục vụ đã được ghi nhận**. Nếu mất kết nối giữa hai bước, đơn vẫn hiện, khách bấm “Thông báo nhân viên” để thử lại. Tải lại trang giữ đúng trạng thái. Khách không thể tự xác nhận đã thanh toán; đơn tiền mặt vẫn UNPAID đến khi nhân viên thu tiền và xác nhận.
2. Với chuyển khoản, đơn hiện QR ngân hàng; sau khi nhân viên kiểm tra tiền vào và đánh dấu PAID, trang QR cập nhật và hiện cùng lời cảm ơn. Chỉ nhân viên có quyền xác nhận mới làm phát sinh phiếu bếp theo quy tắc của rc.2.
3. Bỏ phần nhập URL trang yêu cầu xuất hóa đơn trong Quản lý tiệm và bỏ QR đó khỏi hóa đơn trên quầy, trình duyệt, SUNMI. Cột `invoice_url` giữ trong D1 để tương thích với migration cũ nhưng được xóa giá trị; đây vẫn là biên nhận thanh toán, không phải chứng từ thuế điện tử.
4. QR góp ý trên biên nhận dẫn tới `https://forms.gle/Fpd7b7PdQV9kPBpf7`. Migration chỉ điền URL này khi quán chưa có link góp ý, để không ghi đè link thật đã cấu hình. Chủ tiệm có thể xem hoặc chỉnh trong Quản lý tiệm.
5. Màn hình phụ đọc lựa chọn tiền mặt từ D1: không hiển thị QR ngân hàng cho đơn tiền mặt; khi thanh toán xong hiện lời cảm ơn và thông tin đơn.

## Chạy tại npm local

```sh
npm run test:rc3
node tests/dev-server.mjs
```

Truy cập `/counter/`, `/display/`, `/staff/`, `/qr/?table=T01`. `tests/dev-server.mjs` dùng SQLite trong bộ nhớ; test local không chứng minh D1 thật, giấy in hay tiền đã vào tài khoản. Test tích hợp mới xác minh nhánh tiền mặt, yêu cầu phục vụ, trạng thái qua tải lại, lựa chọn theo đơn, bản in chỉ có QR góp ý, và phiếu bếp chỉ xuất sau thu tiền. Có 6/6 bài kiểm thử tập trung qua. Bộ test cũ `npm test` trước đó còn lỗi vì fixture/hợp đồng hành vi cũ; chưa lấy làm cổng nghiệm thu.

## Trước khi dùng Worker trên D1 thật

1. Sao lưu D1 `pos_unified`, tra bảng `d1_migrations`, xác nhận migration hiện có. Thông tin bàn giao cũ mới xác nhận thật đến 0008.
2. Áp lần lượt 0009 → 0010 → 0011 → 0012 → **0013_cash_intent_feedback.sql**; xác nhận từng bước. Worker rc.3 chặn nhận đơn và API nhân viên nếu thiếu cột `payment_preference` từ 0013. `GET /api/health` phải trả `version: 2.6.0-rc.3`, `d1: ok`.
3. Kiểm tra ở quán: lựa chọn tiền mặt/chuyển khoản trên QR, popup bàn ở quầy, nhân viên nhận tiền trên POS cầm tay, phiếu bếp chỉ ra sau thanh toán; thử reload QR, mất mạng đúng lúc gửi yêu cầu, in biên nhận XP-Q200 và SUNMI, quét QR góp ý ra đúng Form. Máy in bếp cần xác nhận model. Tất cả mục trên **chưa có bằng chứng UAT thật**.
4. Tài nguyên Android đã đồng bộ và versionCode 10; môi trường đóng gói này không có SDK/khóa ký gốc nên chưa tạo APK. Khi biên dịch trên máy có toolchain, dùng khóa ký UAT hiện tại để cài đè trên SUNMI.

Các thay đổi trước rc.3 (mã đơn, hoàn tiền, báo cáo, menu, tem, quản lý ca) ở [ghi chú rc.2](RELEASE_2.6.0_RC2.md). Mục yêu cầu xuất hóa đơn trong ghi chú rc.2 là lịch sử và đã được gỡ ở bản này.
