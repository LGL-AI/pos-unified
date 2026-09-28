# Cài và kiểm tra Lotus POS Counter

## Trước khi cài

Máy quầy Android 11/API 30 cần Internet qua Wi-Fi hoặc Ethernet. Máy chủ trung tâm là Cloudflare Worker `https://pos-unified.lgl247-ai.workers.dev` với D1 `pos_unified`. Worker phải chạy RC5.1 và áp migration D1 `0014_customers.sql`, `0015_qr_table_visits.sql`; `GET /api/health` cần trả `version: 2.6.0-rc.5.1`, `d1: ok`, `qrTableReady: true`, `display: ok`, `echoReady: true`, `autoPrintReady: true`. QR chỉ nhận đơn khi `acceptingOrders: true`.

POS cầm tay, mã QR bàn `https://pos-unified.lgl247-ai.workers.dev/qr/?table=T01` (đổi đúng bàn), app quầy và màn hình khách dùng chung Worker/D1. Nếu đổi domain Worker, cập nhật cả các thiết bị và mã QR bàn.

## Trên máy ASUS Windows

Giải nén ZIP. Để `LotusPOS_Counter_RC5_debug.apk` cạnh `LotusPOS_Test_Windows_ASUS.exe`, chạy EXE bằng nháy đúp. EXE dùng Android Studio/SDK đã cài để mở máy ảo Android 11, cài đè APK và chụp ảnh/log sau khi bạn thao tác. Không cần PowerShell. Bước cuối EXE bật overlay ảo cho màn hình khách rồi trả setting về cũ. Xem `%LOCALAPPDATA%\LotusPOSCounterTest\ket-qua`.

Trong app nhấn **⚙ Thiết bị → Máy chủ POS → Kiểm tra kết nối**. App chỉ chấp nhận một origin RC5.1 đã có D1, màn hình khách và API tự in. Sau đó đăng nhập, tạo món và khách, quét QR bàn thử, nhận đơn QR, xác nhận tiền thực nhận và xem màn hình khách ảo. Nếu server báo 404/RC4 thì áp migration 0014, 0015, triển khai Worker RC5.1 bằng các workflow trong gói source Cloudflare, rồi kiểm tra lại; cài APK không tự cập nhật Worker.

## Trên máy POS thật sau này

Cài APK bằng trình cài gói Android hoặc `adb install -r LotusPOS_Counter_RC5_debug.apk`. Trên máy ảo, vào **Thiết bị → Giả lập PAID**: app dựng byte tem TSPL, phiếu bếp ESC/POS + lệnh cắt, rồi hóa đơn ESC/POS + lệnh cắt; màn hình báo máy in chưa kết nối như dự kiến, không gửi thật và không ghi D1. Trên máy POS thật, chọn USB hóa đơn/tem và cấp quyền, thử in giấy rồi thử màn hình khách vật lý. Tuyến bếp mặc định là `RECEIPT_USB`, tức phiếu bếp và hóa đơn dùng chung máy in đơn; chỉ khi chủ động chọn `LAN` mới cần IP máy bếp KV804 (TCP 9100). Thanh toán PAID được xác minh lại trên D1 rồi tự tạo job in, không có nút xác nhận in thêm. Nếu bếp lỗi, hóa đơn chờ đến khi kiểm tra giấy và thử lại job bếp. Job từ thiết bị khác được quầy kiểm tra khoảng 3 giây một lần khi app mở và đăng nhập. Cấu hình phần cứng chỉ lưu trên chính máy quầy. Két mặc định tắt.
