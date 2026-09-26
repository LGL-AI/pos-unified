# Giao diện quầy từ LotusPOS_POC_VN_CN_FnB_v10_MEMBER.html

Mở `https://pos-unified.lgl247-ai.workers.dev/counter/poc/` sau khi cập nhật GitHub và Cloudflare báo triển khai thành công. File này giữ nguyên toàn bộ HTML, CSS, nút và mã giao diện POC; thay duy nhất ký tự `L` trong ô logo bằng ảnh Echo Coffee mà chủ cửa hàng đã gửi. Logo được nhúng trong HTML để luôn hiển thị.

**Trạng thái sử dụng:** Đây là bản xem và thử giao diện POC. Dữ liệu phát sinh tại trang này chỉ là dữ liệu mô phỏng trong phiên trình duyệt; không ghi vào D1, không đồng bộ với QR, máy cầm tay và màn hình thứ hai. Không thu tiền, quản lý ca hoặc nhập kho thực trên đường dẫn này. Worker ngăn POC gọi API thật, chặn lưu trữ dùng chung và không cho công cụ tìm kiếm lập chỉ mục. Quầy đang giao dịch thật vẫn ở `/counter/` và dùng D1.

## Đưa bản giao diện lên qua GitHub Web

Giải nén gói, vào repository `LGL-AI/pos-unified` ở nhánh `main`, chọn **Add file → Upload files**, kéo các file từ trong thư mục gói vào và xác nhận đúng đường dẫn `src/worker.js`, `public/counter/poc/index.html`, `public/brands/echo-coffee.jpg`. Nếu GitHub không giữ thư mục, mở đúng từng thư mục trên GitHub rồi dùng **Add file → Upload files** tại đó. Commit; chờ Cloudflare báo thành công. Không chạy lại migrations 0001–0009 cho thay đổi giao diện này.

## Việc tiếp theo để đưa POC vào vận hành

Từng thao tác POC (đơn hàng, sản phẩm, tồn kho, hội viên, voucher, ca, chấm công, license, cài đặt, báo cáo) cần dùng API xác thực và D1; phải đối chiếu từng thao tác với 4 màn hình trước khi chuyển `/counter/` sang giao diện này. Cấu hình máy in hóa đơn, máy tem, két, máy quét và nguồn cấp đang có ở UI Thiết bị của quầy thật và ứng dụng bridge; phải gắn lại các trường trên UI POC trong giai đoạn nối API. Thực đơn từ file TXT chưa được đưa vào bản xem giao diện này.
