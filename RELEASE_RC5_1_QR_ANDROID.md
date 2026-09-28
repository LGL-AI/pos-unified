# Bản thử RC5.1 · QR theo bàn + Android Counter P0.6

## Điều ảnh ASUS cho thấy

Settings của máy ảo Android 11/API 30 trả `version=2.6.0-rc.4, D1=ok, display=ok, autoPrint=false`. APK P0.5 có giao diện RC5 nhưng máy chủ vẫn ở RC4, nên không thể hoàn tất thao tác bán hàng với API mới. P0.6 hiển thị màn kiểm tra máy chủ và nút **Kiểm tra lại kết nối / Mở cài đặt**, chỉ mở quầy khi Worker RC5.1, D1, QR bàn, màn hình khách và tự in đã sẵn sàng.

## Cài lên GitHub và Cloudflare

1. Giải nén `LotusPOS_RC5_1_GitHub_Source.zip`, chép toàn bộ nội dung vào **gốc repo `pos-unified`** bằng GitHub Desktop, commit và push. Giữ nguyên thư mục `.github/workflows`, `src`, `public`, `migrations`, `scripts`, `android-counter`. Không upload thư mục `android-counter/build`, `dist` hay khóa ký test lên GitHub.
2. Trong GitHub **Actions → Upgrade Lotus POS D1 0014 and 0015 QR Tables → Run workflow**. Dùng secret `CLOUDFLARE_D1_API_TOKEN` đã cấu hình. Workflow kiểm tra lịch sử và sơ đồ trước, áp `0014_customers.sql` nếu cần, sau đó áp `0015_qr_table_visits.sql` trên D1 `pos_unified`. Chờ xanh.
3. Trong GitHub **Actions → Deploy Lotus POS rc.5.1 to Cloudflare → Run workflow**. Dùng secret `CLOUDFLARE_POS_DEPLOY_TOKEN`. Workflow chạy test, kiểm đủ 15 migration và menu Echo rồi mới deploy.
4. Mở [health](https://pos-unified.lgl247-ai.workers.dev/api/health): cần `version: "2.6.0-rc.5.1"`, `d1: "ok"`, `qrTableReady: true`, `autoPrintReady: true`, `acceptingOrders: true`. Nếu thấy `rc.4`, deployment chưa tới đúng Worker.

Đây là source dành cho **Echo Coffee / Worker `pos-unified` / D1 `pos_unified`**. Đừng upload vào repo hay Worker QR Phát Tài riêng. Cấu hình máy chủ mặc định của APK cũng là `pos-unified.lgl247-ai.workers.dev`.

## QR gọi món theo bàn

- File `Table_QR_99_Ban/links.csv` và `T01.png` … `T99.png` chứa từng link `https://pos-unified.lgl247-ai.workers.dev/qr/?table=T01` … `T99`. Mở bằng camera điện thoại. **Chỉ in và dán các bàn thật** đang có trong **Quản lý tiệm → Số bàn**; mặc định D1 cho phép 99 bàn.
- Khi mở trang QR, trang gửi `POST /api/qr/visit?table=T01`. Worker kiểm mã với số bàn D1, tăng lượt truy cập theo bàn/ngày Việt Nam trong `qr_table_visits`, trả về bàn đã xác nhận. Màn hình khóa vào bàn quét; giỏ, voucher và đơn đều dùng bàn này. Đơn mới tiếp tục lưu `qr_orders.table_id`, đồng bộ tới POS quầy và POS cầm tay.
- Xem trên [Cloudflare D1 Console](https://dash.cloudflare.com/?to=%2F%3Aaccount%2Fworkers%2Fd1), chọn `pos_unified` và chạy:

```sql
SELECT table_id, visit_day, views, last_seen_at FROM qr_table_visits ORDER BY last_seen_at DESC LIMIT 20;
SELECT code, table_id, source, status, payment_status FROM qr_orders ORDER BY created_at DESC LIMIT 20;
```

Nếu đổi tên miền Worker, tạo lại bộ mã bằng `node scripts/generate-table-qr.mjs --origin https://ten-mien-moi --tables 20 --out table-qr-moi`. Số `--tables` phải đúng số bàn đã khai trong Quản lý tiệm.

## Thử trên ASUS / Android Studio

Sau khi health đạt yêu cầu, kéo file `LotusPOS_Counter_RC5_1_debug.apk` vào màn hình máy ảo Android 11/API 30 để cài đè P0.5. APK versionCode **8**, cùng chữ ký debug với bản P0.5 trong gói thử trước. Nếu muốn build/run bằng Android Studio: **File → Open** thư mục `android-counter` bên trong source đã giải nén, Sync, chọn máy ảo API 30 rồi Run. Gradle cần thư mục `public` nằm cùng cấp với `android-counter` để chép UI mới. APK debug do Android Studio tự ký có thể khác chữ ký APK tải sẵn; khi Android Studio báo không cài đè được thì xóa app cũ trong máy ảo rồi Run.

Để chạy EXE test trên Windows ASUS, đặt `LotusPOS_Test_Windows_ASUS.exe` và `LotusPOS_Counter_RC5_debug.apk` (bản P0.6 trong gói, tên này để EXE nhận) cùng một thư mục rồi mở EXE. EXE dùng emulator đã cài bởi Android Studio, không dùng PowerShell. Giỏ món được bố trí ở cột phải trên màn hình máy ảo đủ rộng; ở màn hình nhỏ sẽ xuống dưới.

Thử một luồng: đăng nhập quầy → chọn món, kiểm giỏ bên phải → chốt đơn → mở đơn → xác nhận tiền mặt hoặc chuyển khoản → xem trạng thái PAID và hàng đợi in giả lập. Quét `T01.png` bằng điện thoại, gọi món rồi kiểm QR Order ở quầy, cùng `table_id=T01` trên D1. Thiết bị không có máy in USB/LAN sẽ báo job chờ/lỗi kết nối; không có xác nhận in giấy thật.

## Đã kiểm tra ở bản build

`npm test`: 312/312 pass với SQLite mô phỏng D1. Có test quét T01/T02, ghi lượt truy cập, chặn lệch bàn, đơn xuất hiện trên danh sách nhân viên; thao tác UI Android dạng WebView mô phỏng từ chọn món tới xác nhận tiền và callback in. APK đã build/ký/kiểm tra cấu trúc cho target API 30. Môi trường build này không có Android Emulator thật và không truy cập được Worker `workers.dev`; trạng thái deploy Cloudflare, cài máy ảo ASUS và in giấy cần kiểm tiếp trên thiết bị của bạn.
