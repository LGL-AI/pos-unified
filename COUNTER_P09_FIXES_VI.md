# Lotus POS Counter RC5.1 P0.9 — bản sửa khi test tại quầy

APK Android 11 có `versionCode 11`, `targetSdk 30`, cùng chữ ký test với P0.8 nên cài đè bằng `adb install -r`. POS cầm tay Sunmi V2s không thay đổi. Không có migration D1 mới.

## Đã sửa

- Lệnh in sau thanh toán từng bị `API path denied`: Android kiểm tra quyền qua `/api/staff/me` nhưng đường dẫn này thiếu trong danh sách cho phép của `CloudApi`. Đã thêm đúng đường dẫn đó; luồng vẫn xác minh đơn/bill `PAID` trên D1 trước khi gửi tem, bếp, hóa đơn.
- Khi Worker trả HTML hoặc nội dung rỗng, quầy hiển thị HTTP status và API path (ẩn ID đơn) thay vì thông báo “dữ liệu không hợp lệ” chung. Refresh thành công xóa cảnh báo cũ. Không tự gửi lại lệnh ghi đơn/thanh toán khi chưa rõ kết quả.
- Menu quầy còn ba nút: **Bán hàng**, **Lịch sử đơn**, **Tùy chỉnh cửa hàng**. Mở mục tùy chỉnh để thấy các tính năng theo quyền nhân viên. Trên màn hình giả lập ngang có chiều rộng CSS từ 801 px, menu đứng cố định bên trái; màn hẹp hơn hiển thị ba nút dưới đáy, chữ không trôi ngang.
- Bổ sung tiếng Trung giản thể vào form tạo/sửa món, voucher, khách hàng, nhân viên, cấu hình cửa hàng và các nút bán hàng quan trọng. Tên danh mục do cửa hàng tự nhập vẫn được giữ nguyên; danh mục mẫu có nhãn Trung ở thực đơn.
- Khi màn hình khách ghép D1 thành công, thanh trạng thái Android cập nhật trạng thái mới thay cho lỗi phiên cũ lưu trên thanh này.

## Kiểm chứng

- `npm test`: 327/327 đạt, gồm thao tác quầy qua Worker + D1 mô phỏng, tạo món/khách/voucher, tách bill, thanh toán, đồng bộ màn hình và kiểm tra phản hồi HTML 502.
- `build-local.sh`: APK build và ký thành công. `aapt2`: package `vn.lotusai.pos.counter`, `versionCode 11`, `targetSdk 30`. Chữ ký SHA-256: `ad6c82713740d7387b0748dab420fb7735a3c9ee7a21e5ef0ad5f57ec1d941d0`. Xác nhận JS/CSS P0.9 đã nhúng trong APK.
- Workspace này không có Android emulator hoặc máy in vật lý. Cần xác nhận thao tác chạm và giấy in trên Android Studio/máy quầy của khách; test tự động không thay cho lần đó.

## Cài thử và triển khai

1. Cài đè APK P0.9 trên Android Studio Emulator Android 11 API 30. Không cần xóa P0.8 vì package và chữ ký giống nhau.
2. Đăng nhập; kiểm tra ba nút menu, mở **Tùy chỉnh cửa hàng** → **Sản phẩm / Dịch vụ** và **Voucher / Coupon**. Sau đó thử một đơn từ chọn món tới xác nhận thanh toán. Nếu có HTTP lỗi, chụp cả số HTTP và đường dẫn API đang hiện.
3. Để bản POS quầy trên web cũng nhận menu và bản dịch mới, cập nhật source lên GitHub rồi chạy workflow deploy Cloudflare đang dùng. Worker backend và D1 không cần migration bổ sung cho P0.9. APK nhúng giao diện P0.9 nên có thể cài test với Worker RC5.1 hiện tại.

