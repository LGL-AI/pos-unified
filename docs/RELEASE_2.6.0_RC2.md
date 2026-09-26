# Echo Coffee · Lotus POS Unified 2.6.0-rc.2

Ngày đóng gói: 25/09/2026. Đây là bản mã nguồn để chạy local và tiếp tục UAT; chưa triển khai lên Worker/D1 thật.

## Các thay đổi theo phản hồi của quán

| Mục | Đã sửa trong mã nguồn local |
| --- | --- |
| 1 | Migration 0012 bỏ các trigger tạo phiếu bếp lúc nhận, tạo hoặc sửa đơn. Chỉ sinh một phiếu tổng khi toàn đơn chuyển sang PAID; đơn tách bill chờ bill cuối. API giữ/in phiếu và cầu in tem kiểm tra trạng thái đã thanh toán. Phiếu cũ đã in trước nâng cấp không thể thu hồi. |
| 2 | Màn hình thứ hai có bố cục chỉ dành cho thanh toán: mã QR ngân hàng lớn hơn, tiền, tài khoản, nội dung chuyển khoản và lời cảm ơn. Sau khi thu tiền, hiển thị trạng thái đã thanh toán/lời cảm ơn. |
| 3 | Nút xác nhận giỏ QR dùng chữ thường, kể cả sau vòng cập nhật catalog; tránh hiển thị nguyên thẻ HTML. |
| 4 | QR chỉ có “Thông báo nhân viên”. Yêu cầu lưu D1, quầy hỏi định kỳ và bật popup ghi số bàn. Khách không có API tự đánh dấu đã trả/báo chuyển khoản. POS cầm tay kiểm tra tiền, xác nhận và gửi phiếu bếp sau khi thanh toán. |
| 5 | Phiếu thanh toán bổ sung tên/địa chỉ/MST quán, bàn, mã đơn, thời gian, từng món và đơn giá/số lượng/thành tiền, tổng, phương thức, tiền nhận/thối, hội viên. Có hai QR riêng cho góp ý và **trang yêu cầu** xuất hóa đơn khi chủ tiệm điền liên kết HTTPS thật trong Quản lý tiệm. Đây vẫn là biên nhận, chưa phải hóa đơn VAT đã phát hành. |
| 6–7 | Tem XP-365B và phiếu bếp in Code 128 chứa toàn bộ mã đơn; phiếu bếp có bàn, ngày giờ, số phiếu và món/tùy chọn. Tem cần cao tối thiểu 30 mm. |
| 8–10 | Mã đơn mới `DDMMYYYY-0001-XXXXXX-CK/TM`: ngày giờ Việt Nam, số thứ tự duy nhất mỗi ngày, sáu ký tự cuối mã hội viên (khách lẻ `000000`), hậu tố theo phương thức thu. Nội dung chuyển khoản của **đơn nguyên** trùng chính xác mã `...-CK`; tách bill thêm `B1`, `B2` (bỏ dấu nối trong nội dung ngân hàng để giữ giới hạn độ dài QR). Quầy/scanner/tra hoàn tìm được mã CK hoặc TM và mã bill. Đơn cũ giữ mã cũ. |
| 11–13 | Giao diện đăng ký QR được căn lại; điện thoại chỉ nhận 10 hoặc 11 số bắt đầu bằng 0. Mật khẩu ban đầu bằng điện thoại, lưu dạng băm. Hội viên đăng nhập trên QR hoặc yêu cầu quầy đổi mật khẩu sau khi nhập mật khẩu cũ; mật khẩu mới 1–11 ký tự, các phiên cũ bị hủy. |
| 14 | Ghi khoản hoàn theo món trả về/đền bù gồm tên món, số lượng, số tiền. Dashboard liệt kê người chấm công tại đúng thời điểm hoàn và người ghi khoản hoàn; dòng lịch sử thiếu chi tiết được ghi là chưa phân loại. |
| 15 | Sidebar quầy giữ vị trí cuộn khi đổi màn và cập nhật dữ liệu. |

## Chạy local và kiểm thử

```sh
npm run test:rc2
node --test tests/counter-raster.test.mjs
node tests/dev-server.mjs
```

Mở `http://127.0.0.1:8766/counter/`, `/staff/`, `/display/` và `/qr/?table=T01` trên máy chạy server. DB trong `tests/dev-server.mjs` là SQLite trong bộ nhớ: tắt server là mất dữ liệu; không phải D1 thật. Mật khẩu POS test nằm trong harness local, không áp dụng quán.

Các bài mới kiểm tra: QR → yêu cầu nhân viên → xác nhận → phiếu bếp; bill tách chỉ in sau bill cuối; mã CK/TM và tra mã hoàn; giới hạn số điện thoại/mật khẩu; hoàn tiền theo món, chấm công và gửi lại cùng mã không hoàn đôi; raster hóa tem. Kết quả: 4/4 bài rc.2 và 1/1 bài raster qua. **Không có bằng chứng giấy in, máy quét, tiền vào tài khoản hoặc UAT D1 thật.** `npm test` toàn bộ: 27 qua, 30 lỗi trên 57 bài do nhiều fixture vẫn chỉ dựng schema 0008 và một số bài đòi bếp in trước thanh toán. Cần chuyển các bài cũ theo hợp đồng rc.2 trước khi dùng làm cổng phát hành.

## Đưa lên D1 thật sau khi chốt UAT local

1. Sao lưu D1 `pos_unified` và kiểm tra `SELECT name FROM d1_migrations ORDER BY id;`. Bản bàn giao trước chỉ xác nhận đến 0008; không suy đoán 0009–0011 đã được áp.
2. Áp 0009 theo workflow nâng cấp riêng hiện có; sau đó áp 0010, 0011, 0012 **theo đúng thứ tự và xác nhận mỗi lần**. Không deploy mã mới khi cấu trúc D1 chưa đủ: `/api/health` phải trả `d1: ok`, `echoReady: true` và `version: 2.6.0-rc.2`.
3. Ở POS quầy → Quản lý tiệm, nhập **link Google Form thật** vào mục góp ý và link HTTPS **trang tiếp nhận yêu cầu xuất hóa đơn** vào mục hóa đơn. Người dùng chưa đưa hai URL này, nên gói local để trống và không in QR rỗng.
4. Kiểm tra trực tiếp XP-Q200 (giấy/két), XP-365B (barcode trên tem), mẫu máy in bếp còn thiếu, scanner HID/LAN, màn phụ và SUNMI. Nguồn Android đã đồng bộ nhưng môi trường này không có Android SDK/khóa ký UAT, chưa tạo APK cập nhật; phải build bằng khóa gốc để nâng ứng dụng trên máy.

Mọi UAT tại quán vẫn ở trạng thái **chưa kiểm chứng**, không tính các test Node/SQLite vào ngưỡng 80 ca chéo có kết quả thật.
