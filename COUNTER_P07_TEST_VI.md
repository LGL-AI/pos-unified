# Lotus Counter RC5.1 P0.7 — Android 11 / API 30

## Cài APK trước

Kéo LotusPOS_Counter_RC5_1_P07_Android11.apk vào cửa sổ máy ảo đang chạy.
Cài đè bản cũ, không gỡ app hoặc xóa dữ liệu. Version code 9, tên phiên bản
2.6.0-rc.5.1-counter-p0.7; giữ khóa ký debug như bản trước.
Nếu báo chữ ký khác, dừng và gửi lỗi; không xóa dữ liệu để vượt qua.
Địa chỉ Cloudflare và đăng nhập hiện tại được giữ khi cài đè.

## Sửa trong bản này

- WebView bật hộp thoại Android cho confirm/prompt/alert (trước đây thiếu WebChromeClient).
- Món ở quầy dùng popup trong trang, không phụ thuộc prompt để thêm giỏ.
- Popup dùng top/right/bottom/left, không phụ thuộc CSS inset trên WebView cũ.
- Back/Escape đóng popup; chuyển mục có thể thoát trạng thái chọn món bị kẹt.
- Lỗi dựng popup không giữ trạng thái khóa toàn bộ các nút.
- Menu giữ cả vị trí cuộn ngang và dọc sau cập nhật.
- Scanner cuộn ô nhập vào vùng nhìn thấy và đặt con trỏ.
- Thêm nút kết nối lại màn hình khách. Không đổi app Sunmi V2s.

## Test ngay trên ASUS

1. Mở app, kiểm tra báo D1 trực tuyến.
2. Chọn Xoài đá xay → popup hiện → thêm vào giỏ → giỏ bên phải tăng 1.
3. Mở/đóng popup 20 lần; bấm nhanh; thử Back; chuyển Sản phẩm/Khách hàng/Bán hàng.
4. Kéo menu ngang tới mục cuối, chọn mục; menu không tự về đầu.
5. Bấm Scanner; ô quét phải hiện và có con trỏ. Nhập BLEND001 rồi Enter.
   Đây là nhận mã USB/Bluetooth HID hoặc nhập tay; không phải bật camera.
6. Chốt đơn → xác nhận → tiền mặt/chuyển khoản → xác nhận đã nhận tiền.
   Chỉ xác nhận trên đơn thử; thao tác ghi DB thật. Không có máy in thì kiểm tra
   hàng đợi/lỗi chưa kết nối, không coi là đã in giấy. Tránh gửi lại đơn chỉ vì thiếu máy in.

## Màn hình thứ hai của máy ảo

1. Trong Android Emulator chọn ⋮ → Displays.
2. Add secondary display → 1280 × 800, landscape, density 160 nếu có → Apply Changes.
3. Trở lại app đã đăng nhập → Màn hình thứ hai → Kết nối lại màn hình khách.
4. Thêm món, tăng/giảm số lượng: màn khách phải cập nhật tổng từ Worker.
5. Chốt đơn: kiểm tra mã đơn/QR thanh toán theo cấu hình ngân hàng trên server.
6. Xác nhận nhận tiền: màn khách phải hiện đã thanh toán và bỏ QR thu tiền.
7. Nếu vẫn ghi Secondary displays (0), màn phụ chưa được tạo; không phải lỗi ghép D1.

## GitHub / Cloudflare

APK chứa giao diện mới: test APK không cần deploy Worker hay migration.
Muốn bản POS web cũng nhận sửa menu/popup/Scanner, chép nội dung source ZIP vào
repo hiện tại, kiểm tra git diff, commit/push để workflow deploy như lần trước.
ZIP không chứa .git, mật khẩu, signing key, node_modules hay build cache.
Không thay .env/.dev.vars hoặc chạy lại migration chỉ để cài P0.7.

## Giới hạn xác minh

Đã có test tích hợp chạy Worker thật trong tiến trình với SQLite adapter cho D1,
luồng UI bằng DOM giả lập: chọn món Echo, giỏ, Scanner, điều hướng, tạo khách/món,
chốt đơn, thanh toán, bridge và đồng bộ màn khách; kèm kiểm tra code tương thích.
Đây không phải kết quả chạy Android Emulator hoặc in giấy thật. Môi trường build
hiện không có emulator hoạt động; tải trình duyệt để kiểm thử hình ảnh cũng lỗi.
Do đó cần hoàn tất checklist thao tác trên máy ảo ASUS trước khi dùng bán hàng thật.
