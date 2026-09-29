# Lotus POS Counter RC5.1 P0.10 — màn hình khách thứ hai

## Thiết lập trên ASUS, Android Studio API 30

1. Mở máy ảo Android 11. Trong cửa sổ máy ảo bấm dấu **⋮ (Extended Controls)** → **Displays** → **Add secondary display**.
2. Chọn **Display 1**, preset **720p (1280 × 720)** và bấm **Apply Changes** ở góc dưới bên phải. Nếu mới chọn preset mà chưa bấm Apply Changes thì Android chưa có màn hình phụ.
3. Cài đè APK P0.10 (`adb install -r LotusPOS_Counter_RC5_1_P010_Android11.apk`), mở Lotus POS Counter và đăng nhập như thường lệ. Không xóa app cũ: cùng package và chứng chỉ test với P0.9.
4. Vào **Tùy chỉnh cửa hàng → Màn hình thứ hai**. Mục này phải ghi **Đã nhận 1 màn hình khách · 1280 × 720**. Nếu còn lỗi phiên cũ, bấm **Kiểm tra và ghép lại màn hình**. Trên Display 1, chọn một món ở Bán hàng để thấy giỏ và giá do D1 tính; sau khi chốt và thanh toán, màn hình đổi trạng thái.
5. Khi mang tới quầy thật, nối cổng HDMI/màn hình khách trước hoặc sau khi mở app; app tìm màn hình phụ theo Android DisplayManager, không cố định ID 1. Cần xác nhận thao tác chạm, máy in, và độ phân giải thực tế trên thiết bị của khách.

## Đã sửa

- Chỉ ghép D1 khi Android đã nhận màn hình phụ; thêm màn hình sau khi đăng nhập thì tự ghép. Khi đổi nhân viên, đăng xuất hoặc bấm ghép lại, xóa phiên cũ và không giữ màn hình khách ở đơn trước.
- Token nhân viên mới bỏ qua thời gian chờ 30 giây còn lại của lần ghép lỗi. Ghép lại tạo một phiên D1 mới, không chỉ tải lại WebView. Các PUT dùng ID màn hình, số revision và epoch đã chụp tại lúc gửi để tránh ghi nhầm vào phiên mới.
- Trạng thái màn hình trên POS hiển thị tên/độ phân giải rõ ràng; màn hình khách có lời nhắc đăng nhập trong lúc chờ ghép.

## Kiểm chứng và giới hạn

- `npm test`: 327/327 đạt; test mới đọc màn hình khách bằng token ghép, kiểm tra giỏ định giá trên D1 và xác nhận PAID được vẽ lên màn hình. Test Android UI mô phỏng sự kiện nhận Display 1 và nút ghép lại.
- Biên dịch và ký APK thành công: `versionCode 12`, `targetSdk 30`, cùng chứng chỉ SHA-256 `ad6c82713740d7387b0748dab420fb7735a3c9ee7a21e5ef0ad5f57ec1d941d0`; đã kiểm tra các asset màn hình và JS nằm trong APK.
- Môi trường build này không có tiến trình Android Emulator và màn hình/HDMI của khách; cần chạy các bước trên ASUS để xác nhận Android thực sự tạo Display 1. Không có thay đổi schema D1 hoặc Worker API cho P0.10. Source mới có sửa giao diện màn hình khách, nên cập nhật GitHub/Cloudflare khi muốn web cũng dùng lời nhắc mới; APK đã nhúng giao diện P0.10.
