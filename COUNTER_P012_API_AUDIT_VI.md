# Lotus POS quầy RC5.1/P0.12 — rà API và bridge

## Đã rà và sửa

- Đối chiếu các đường dẫn API mà giao diện quầy và Android gọi với Worker, gồm đơn/bill, kho, ca, voucher, khách hàng, màn hình khách và job bếp; `/api/status`, `/api/config`, `/api/jobs`, `/api/scans` thuộc cầu in Windows tại `127.0.0.1:18181`, không thuộc Worker Cloudflare. APK Android bỏ qua cầu in Windows.
- Ghi token tại thời điểm gửi mỗi request. Khi phản hồi phiên cũ đến sau khi đăng nhập phiên mới, giao diện bỏ qua phản hồi đó; HTTP 401 cũ không xóa phiên mới hoặc làm màn hình báo offline.
- Hook theo dõi thanh toán của APK ghi token cùng request; lệnh in từ phản hồi phiên cũ không dùng token của tài khoản mới. Hàng đợi SQLite dùng ID cố định để tránh in lặp khi UI và hook cùng báo thanh toán.
- HTML nhúng trong APK có CSP chặn iframe, script ngoài origin và object. Chỉ trang POS quầy hợp lệ được mở bridge; liên kết ngoài mở ứng dụng ngoài. Bỏ các hàm bridge không dùng.
- CloudApi đóng kết nối trong `finally`, kiểm tra UUID trong allowlist và báo rõ HTTP/path khi máy chủ trả HTML hoặc văn bản thay JSON.

## Kiểm tra

- `npm test`: 329/329 pass, gồm test hồi quy 401 phiên cũ và hook in thanh toán.
- APK build với Android SDK, target API 30; kiểm tra chữ ký, versionCode và asset kèm theo khi đóng gói.
- Không có máy in, máy POS hay Android emulator trong môi trường build; cần chạy APK trên Android Studio của ASUS và thử in thật khi gắn thiết bị.

## Cài thử

VersionCode 14 dùng cùng applicationId và khóa debug của P0.11. Cài đè bản cũ bằng `adb install -r <ten-apk>` hoặc kéo thả APK vào emulator Android 11. Worker RC5.1 và migrations D1 0014–0015 vẫn phải có trên Cloudflare. Thay đổi P0.12 chủ yếu nằm trong APK/source giao diện quầy; nếu GitHub/Cloudflare đang ở P0.11 thì cần cập nhật source để web quầy cũng nhận sửa lỗi phiên cũ.
