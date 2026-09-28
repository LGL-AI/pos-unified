# Test POS quầy Android 11 và Bridge web

## File trong gói

- `LotusPOS_Counter_RC5_1_Android11_Test.apk`: APK debug để cài máy ảo Android 11/API 30, package `vn.lotusai.pos.counter`, versionCode 8. Cùng chữ ký với APK RC5.1 trước nên có thể cài đè bằng `adb install -r`. Không đưa APK, thư mục build/dist hoặc khóa ký lên GitHub.
- ZIP source GitHub chứa Worker, bốn UI, Android source, migrations, tests và `.github/workflows`; giải nén toàn bộ vào gốc repo `LGL-AI/pos-unified` rồi commit/push. Đừng upload chính file ZIP vào repo.

## Thứ tự triển khai

1. Kiểm tra nhánh `main` trên GitHub đã nhận đủ source RC5.1 từ ZIP. Bản `main` đọc được lúc đóng gói còn ở commit `51e4c98` (RC4); branch source dùng để đóng gói ở `8accc6f` cộng thay đổi Bridge web. Phải đưa source mới lên `main`.
2. GitHub Actions → **Upgrade Lotus POS D1 0014 and 0015 QR Tables** → **Run workflow**, chờ xanh. Workflow dùng `CLOUDFLARE_D1_API_TOKEN`; nếu D1 đã đủ 15 migration, bước kiểm tra vẫn xác nhận mà không nhập lại dữ liệu.
3. GitHub Actions → **Deploy Lotus POS rc.5.1 to Cloudflare** → **Run workflow**, chờ xanh. Workflow dùng `CLOUDFLARE_POS_DEPLOY_TOKEN`, chạy test và kiểm tra D1 trước khi deploy. Riêng công tắc Bridge chỉ sửa `public/staff/staff.js`, không thêm migration mới.
4. Mở https://pos-unified.lgl247-ai.workers.dev/api/health và kiểm `version=2.6.0-rc.5.1`, `d1=ok`, `qrTableReady=true`, `autoPrintReady=true`, `acceptingOrders=true`. Môi trường đóng gói không truy cập được URL này nên phải kiểm trực tiếp trên PC của bạn.

## Test trên Android Studio (ASUS)

1. Mở máy ảo Android 11/API 30. Kéo APK vào màn hình máy ảo để cài. Nếu Android báo lỗi cài đè, gỡ app **Lotus POS Counter** cũ rồi kéo APK vào lần nữa.
2. Mở app → **Thiết bị** → để máy chủ `https://pos-unified.lgl247-ai.workers.dev` → **Kiểm tra lại kết nối**. Nếu báo RC4/D1 lỗi, hoàn tất deploy ở trên rồi thử lại.
3. Đăng nhập, mở **Bán hàng**, thêm món và xem giỏ, chốt đơn, mở đơn, xác nhận thanh toán. Vào **Khách hàng** tạo khách; vào **Thiết bị Android** mở phần cấu hình phần cứng. Không có máy in thật thì lệnh in có thể vào hàng đợi hoặc báo chưa kết nối; kiểm trạng thái mà không nhận là đã in giấy.
4. APK Android không có công tắc Bridge web và tiếp tục luồng in native. Để demo không gửi lệnh từ trình duyệt, mở `/counter/` trên Chrome PC → **Thiết bị** → **Bridge máy in POS web → OFF**. OFF chỉ áp dụng trình duyệt ấy; D1 vẫn ghi đơn/thanh toán thật, các máy khác vẫn có thể tự in.

## Lưu ý

Chỉ cập nhật Worker/source GitHub một lần cho các thay đổi này; APK debug được cài thủ công trên máy ảo. Không cần thay APK Sunmi V2s. Test source `npm test`: 313/313 đạt. APK đã build, xác minh chữ ký và targetSdk 30; chưa chạy trên emulator hay in giấy thật trong môi trường đóng gói.
