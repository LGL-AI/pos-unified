# Lotus POS Counter P0.11 — xoay màn hình và cỡ giao diện

Trong APK Android 11, bấm **⚙ Thiết bị** trên thanh trên cùng (hoặc **Tùy chỉnh cửa hàng → Cài đặt & thiết bị → Mở cài đặt phần cứng**). Ngay đầu trang chọn một trong sáu kiểu:

| Chiều | Gọn | Vừa | Rộng |
| --- | --- | --- | --- |
| Dọc | 720 × 1280 | 800 × 1280 | 1080 × 1920 |
| Ngang | 1280 × 720 | 1280 × 800 | 1920 × 1080 |

Chọn một kiểu rồi quay về **Bán hàng**; lựa chọn được lưu trên máy và áp dụng khi mở lại app. Chế độ dọc chuyển menu xuống dưới, món và giỏ xếp theo chiều dọc. Chế độ ngang dùng layout quầy với menu bên trái trên màn hình đủ rộng. Gọn/vừa/rộng thay mật độ nút, chữ, thẻ món; **đây là cỡ tham chiếu cho bố cục, không đổi độ phân giải vật lý của Android hoặc Display 1**. Màn hình khách thứ hai giữ layout riêng và phiên ghép D1.

P0.11 dùng `versionCode 13`, `targetSdk 30`, cùng chữ ký test với P0.10 nên cài đè được. Không cần cập nhật schema D1 hay Worker API cho lựa chọn này. CSS cấu hình mới có trong APK; ZIP source để cập nhật GitHub khi cần đồng bộ file nguồn. Kiểm chứng build, chữ ký, asset và test tự động; việc nhìn giao diện thực trên máy ảo/máy quầy của khách cần thử tại đó.
