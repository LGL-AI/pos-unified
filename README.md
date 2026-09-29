> Bản thử POS quầy Android 11 RC5.1/P0.12: xem [kiểm tra API và sửa lỗi phiên](COUNTER_P012_API_AUDIT_VI.md), [sáu cấu hình dọc/ngang](COUNTER_P011_LAYOUT_VI.md) và [cách bật màn hình khách thứ hai](COUNTER_P010_DISPLAY_VI.md). APK versionCode 14; Worker RC5.1 và D1 0014–0015 cần đã được triển khai. POS cầm tay Sunmi V2s là ứng dụng riêng.

# Lotus POS Unified · Echo Coffee 2.6.0-rc.5.1 (gói Cloudflare)

Đọc [hướng dẫn đưa RC5.1 lên Cloudflare và thử Android](RELEASE_RC5_1_QR_ANDROID.md) trước khi đẩy source. **D1 thật phải có 0001–0015 trước khi workflow deploy.** Bản này có QR bàn ghi lượt mở trên D1, Khách hàng dùng D1 và in hóa đơn, phiếu bếp, tem tự động sau xác nhận thanh toán tại quầy. Kiểm thử local không thay thế kiểm tra máy in thật ở tiệm.

Đọc [phạm vi đã nối D1, chỗ POC còn thiếu và cách mở local](docs/ECHO_COFFEE_2.6_RC1.md) trước khi dùng bản thử này. Phần bên dưới mô tả nền 2.5.1 đã có trước gói Echo Coffee.

## Thay đổi 2.5.1 (chưa tự áp lên quán)

- Đơn QR/quầy/POS cầm tay bán món đang bật dù tồn món hoặc nguyên liệu bằng 0. Không yêu cầu nhập giả tồn để thử bán.
- Tồn ghi sổ/phiếu nhập được giữ độc lập; `pos_inventory_estimates` ghi mức tiêu hao ước tính có thể âm và không khóa bán. Hủy món/đơn, nhập kho, hoàn tiền chọn nhập lại đều điều chỉnh tồn ước tính; nhật ký đơn vẫn giữ nguyên.
- Nếu D1 đã áp đến 0008: tải `migrations/0009_sales_independent_inventory.sql`, `scripts/upgrade-d1-0009.mjs` và `.github/workflows/upgrade-d1-0009.yml` lên GitHub theo đúng đường dẫn. Chạy workflow `Upgrade Lotus POS D1 0009 - Sales independent from inventory` và kiểm tra Console thấy 9 dòng migration, dòng cuối là 0009. **Chỉ sau đó** cập nhật Worker/4 UI. Không chạy SQL xóa hay sửa tồn kho trực tiếp.
- POS quầy lấy trực tiếp POC `LotusPOS_POC_VN_CN_FnB_v10_MEMBER.html` làm mẫu cho sidebar song ngữ, đầu trang, thẻ bán hàng, tìm kiếm/danh mục, màn QR Order, bảng sản phẩm/voucher + form và lịch ca 7 ngày × 16 giờ; các ô lịch và nút đang có giữ hành vi D1. Đây là bước chuyển giao diện, **chưa phải bản sao đủ mọi màn/tính năng giả lập**: OT, đổi ca, nghỉ phép và checklist trong POC còn cần mô hình dữ liệu/API riêng, không hiển thị nút giả tạo dữ liệu localStorage trên quầy thật.

Bốn đường dẫn trên cùng Worker `pos-unified` và database `pos_unified`:

| UI | Đường dẫn | Công việc |
| --- | --- | --- |
| POS quầy | `/counter/` | Bán hàng, chủ tiệm cấu hình, kho, voucher, nhân viên, báo cáo, in quầy |
| Màn hình thứ hai | `/display/` | Xem giỏ và khoản phải thu từ phiên ghép D1 |
| POS cầm tay | `/staff/` hoặc APK riêng `vn.lotusai.pos.cloudpilot` | Gọi món, bếp, bill, kho, chấm công |
| Khách quét QR | `/qr/?table=T01` | Ghi bàn lúc truy cập, gọi món tại bàn đã quét, hội viên, voucher, QR thanh toán |

**Cài bằng trình duyệt, không nhập lệnh ở máy của bạn:** [DEPLOY_TUNG_BUOC.md](DEPLOY_TUNG_BUOC.md). Cần áp migration `0008_store_config.sql` **trước** khi cập nhật Worker 2.5.0. GitHub Action chạy `scripts/upgrade-d1-0008.mjs`, kiểm tra lịch sử/sơ đồ D1 và chỉ thêm cấu trúc còn thiếu. Khi D1 đã có 0008, upload Worker từ GitHub để Cloudflare tự build.

Trong **POS quầy → Quản lý tiệm**, chủ tiệm đặt tên/địa chỉ/mã số thuế/logo/số bàn, BIN/tên ngân hàng/tài khoản/người nhận, tiền tố chuyển khoản, giá đã gồm thuế hoặc cộng thuế, thuế suất, link GitHub. Đơn chốt lưu ảnh chụp ngân hàng, thuế và ghi chú để thay đổi sau này không sửa tiền của đơn cũ. Nội dung VietQR phát sinh theo đơn và bill, gồm tiền, tài khoản và mã nhận diện riêng. Form **POS quầy → Thiết bị** lưu IP/port, LAN hoặc máy in Windows USB/Bluetooth cho XP-Q200 và XP-365B, kích két theo XP-Q200, máy quét HID hoặc LAN TCP. Cầu in cài trên máy Windows tại quầy, không đặt IP và mã ghép trên GitHub. Máy SUNMI cầm tay vẫn dùng máy in tích hợp và máy bếp LAN do APK cài riêng, không gửi lệnh sang cầu in quầy. Chi tiết tại [hướng dẫn thiết bị](docs/IN_QUAY_XPRINTER.md).

**POS quầy bản web → Thiết bị → Bridge máy in POS web:** ON (mặc định) in/mở két theo quy trình; OFF dùng để trình diễn trên trình duyệt mà không gửi lệnh in hoặc mở két từ trình duyệt đó. Công tắc lưu cục bộ theo trình duyệt, không làm thay đổi APK POS quầy Android 11 hoặc APK Sunmi V2s. OFF **vẫn tạo đơn, khách hàng và thanh toán thật trên Cloudflare D1**, màn hình thứ hai vẫn đồng bộ; các máy khác nối chung D1 vẫn có thể tự in. Khi bật ON, trình duyệt này không tự in bù các phiếu đã thanh toán trước lúc bật. Không dùng OFF như môi trường dữ liệu thử nghiệm riêng.

Nhân viên có thể tách 2 đến số phần món thành từng bill rồi gộp **hai bill chưa thanh toán cùng đơn**; bill đã trả không thể gộp. Dashboard và CSV dùng thanh toán của từng bill, theo ngày Việt Nam, riêng hoàn tiền thuộc ngày thực trả. Mã license POC `XXXX-XXXX-XXXX-XXXX` băm trên D1, che đầy đủ mã khi đọc; trạng thái hết hạn POC chỉ mô phỏng, không khóa bán hàng.

Phiên bản 2.5.0 cần `SESSION_SECRET` trong Cloudflare và `POS_STAFF_PASSWORD` được chủ tiệm giữ bí mật; GitHub Action cần repository secret `CLOUDFLARE_D1_API_TOKEN`. Đổi các secret này tại dashboard nền tảng, không nhập vào GitHub source, mã QR hay form công khai. `ORDERING_ENABLED=true` trong `wrangler.jsonc`. Biến BANK_* cũ không còn được dùng để tạo đơn; ngân hàng lưu ở **Quản lý tiệm** trên D1.

Nguồn Android 2.4.0 đã đồng bộ scanner, thuế và tên quán; **không có APK 2.4.0 ký sẵn trong gói này** vì môi trường đóng gói không có Android SDK và khóa ký UAT cũ. APK Cloud 2.3.0 hiện tại tiếp tục gọi Worker để ghi đơn/in; hóa đơn native của nó không in dòng thuế mới. Khi cần phát hành APK cập nhật tại tiệm, phải biên dịch nguồn Android bằng đúng khóa UAT cũ để máy nâng cấp được. APK cloud có package riêng, không đè ứng dụng POS local.

Mã nguồn được thử bằng `npm test`: SQLite mô phỏng toàn bộ migration, 156 thao tác chéo có tên riêng trong [ma trận](tests/cross-ui-70.test.mjs), chức năng thiết bị ảo, tài chính và [báo cáo](TEST_REPORT.md). Đây không thay thử trực tiếp USB/Bluetooth/LAN, giấy in hoặc tài khoản ngân hàng tại tiệm.
