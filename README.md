# Lotus POS Unified 2.5.0 · 4 UI dùng chung Cloudflare D1

Bốn đường dẫn trên cùng Worker `pos-unified` và database `pos_unified`:

| UI | Đường dẫn | Công việc |
| --- | --- | --- |
| POS quầy | `/counter/` | Bán hàng, chủ tiệm cấu hình, kho, voucher, nhân viên, báo cáo, in quầy |
| Màn hình thứ hai | `/display/` | Xem giỏ và khoản phải thu từ phiên ghép D1 |
| POS cầm tay | `/staff/` hoặc APK riêng `vn.lotusai.pos.cloudpilot` | Gọi món, bếp, bill, kho, chấm công |
| Khách quét QR | `/qr/?table=T01` | Chọn bàn/món, hội viên, voucher, QR thanh toán |

**Cài bằng trình duyệt, không nhập lệnh ở máy của bạn:** [DEPLOY_TUNG_BUOC.md](DEPLOY_TUNG_BUOC.md). Cần áp migration `0008_store_config.sql` **trước** khi cập nhật Worker 2.5.0. GitHub Action chạy `scripts/upgrade-d1-0008.mjs`, kiểm tra lịch sử/sơ đồ D1 và chỉ thêm cấu trúc còn thiếu. Khi D1 đã có 0008, upload Worker từ GitHub để Cloudflare tự build.

Trong **POS quầy → Quản lý tiệm**, chủ tiệm đặt tên/địa chỉ/mã số thuế/logo/số bàn, BIN/tên ngân hàng/tài khoản/người nhận, tiền tố chuyển khoản, giá đã gồm thuế hoặc cộng thuế, thuế suất, link GitHub. Đơn chốt lưu ảnh chụp ngân hàng, thuế và ghi chú để thay đổi sau này không sửa tiền của đơn cũ. Nội dung VietQR phát sinh theo đơn và bill, gồm tiền, tài khoản và mã nhận diện riêng. Form **POS quầy → Thiết bị** lưu IP/port, LAN hoặc máy in Windows USB/Bluetooth cho XP-Q200 và XP-365B, kích két theo XP-Q200, máy quét HID hoặc LAN TCP. Cầu in cài trên máy Windows tại quầy, không đặt IP và mã ghép trên GitHub. Máy SUNMI cầm tay vẫn dùng máy in tích hợp và máy bếp LAN do APK cài riêng, không gửi lệnh sang cầu in quầy. Chi tiết tại [hướng dẫn thiết bị](docs/IN_QUAY_XPRINTER.md).

Nhân viên có thể tách 2 đến số phần món thành từng bill rồi gộp **hai bill chưa thanh toán cùng đơn**; bill đã trả không thể gộp. Dashboard và CSV dùng thanh toán của từng bill, theo ngày Việt Nam, riêng hoàn tiền thuộc ngày thực trả. Mã license POC `XXXX-XXXX-XXXX-XXXX` băm trên D1, che đầy đủ mã khi đọc; trạng thái hết hạn POC chỉ mô phỏng, không khóa bán hàng.

Phiên bản 2.5.0 cần `SESSION_SECRET` trong Cloudflare và `POS_STAFF_PASSWORD` được chủ tiệm giữ bí mật; GitHub Action cần repository secret `CLOUDFLARE_D1_API_TOKEN`. Đổi các secret này tại dashboard nền tảng, không nhập vào GitHub source, mã QR hay form công khai. `ORDERING_ENABLED=true` trong `wrangler.jsonc`. Biến BANK_* cũ không còn được dùng để tạo đơn; ngân hàng lưu ở **Quản lý tiệm** trên D1.

Nguồn Android 2.4.0 đã đồng bộ scanner, thuế và tên quán; **không có APK 2.4.0 ký sẵn trong gói này** vì môi trường đóng gói không có Android SDK và khóa ký UAT cũ. APK Cloud 2.3.0 hiện tại tiếp tục gọi Worker để ghi đơn/in; hóa đơn native của nó không in dòng thuế mới. Khi cần phát hành APK cập nhật tại tiệm, phải biên dịch nguồn Android bằng đúng khóa UAT cũ để máy nâng cấp được. APK cloud có package riêng, không đè ứng dụng POS local.

Mã nguồn được thử bằng `npm test`: SQLite mô phỏng toàn bộ migration, 156 thao tác chéo có tên riêng trong [ma trận](tests/cross-ui-70.test.mjs), chức năng thiết bị ảo, tài chính và [báo cáo](TEST_REPORT.md). Đây không thay thử trực tiếp USB/Bluetooth/LAN, giấy in hoặc tài khoản ngân hàng tại tiệm.
