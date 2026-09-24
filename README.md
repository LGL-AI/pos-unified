# Lotus POS Unified · Phát Tài · UAT 2.1.1

Source dành cho GitHub [`LGL-AI/pos-unified`](https://github.com/LGL-AI/pos-unified), deploy lên Cloudflare Worker **`pos-unified`** tại `https://pos-unified.lgl247-ai.workers.dev`. D1 đã được điền theo ảnh Cloudflare: **`pos_unified`** (`4a07644e-6038-4482-a90f-e55c6c2ebd8d`). Ngày 24/09/2026, D1 Console trả lỗi `incomplete input` khi dán tệp SQL gộp; câu SELECT kiểm tra sau lỗi xác nhận không có bảng/trigger ứng dụng. [Hướng dẫn web](DEPLOY_TUNG_BUOC.md) dùng nút chạy thủ công GitHub Actions trong [`.github/workflows/initialize-d1.yml`](.github/workflows/initialize-d1.yml) để áp 5 migration theo lịch sử D1; không dán lại tệp SQL gộp. Các biểu thức CASE trong trigger đã được đặt trong ngoặc để tránh lỗi phân tách câu lệnh SQL từng được ghi nhận ở D1. Khách mở `/?table=T01` hoặc `/qr/?table=T01`; nhân viên truy cập `/staff/` trên web hoặc APK.

APK cloud có package `vn.lotusai.pos.cloudpilot`, riêng với app offline `vn.lotusai.pos.handheld`; cài cạnh nhau và không ghi đè dữ liệu offline. Chủ tiệm đã xác nhận in SUNMI và KV804 ổn định ở tiệm trên bản trước; bản 2.1.1 giữ nguyên thiết lập kết nối và in, dùng cơ chế xác thực của bản cloud 2.1.0. Chưa nối tới D1 thật hoặc thử APK 2.1.1 trên SUNMI tại tiệm.

## Chức năng

| Nghiệp vụ | Hành vi |
|---|---|
| QR khách | Chọn bàn/món, hội viên, voucher, đặt món; nhận mã QR ngân hàng/PNG hoặc trả tiền mặt. Khách báo chuyển khoản **không** tự xác nhận đã thanh toán. |
| POS nhân viên | Đơn khách và đơn nhân viên chung D1; nhận đơn, in phiếu bếp; thêm/hủy món chỉ in phần thay đổi; nhân viên kiểm tra tiền rồi xác nhận PAID và in biên nhận. |
| Tách bill | 2 đến số phần ăn trong đơn, mỗi phần đúng một bill; tổng tiền/giảm giá được bảo toàn; đơn gốc PAID sau bill cuối. |
| Tích điểm cloud | Thành viên nhận `floor(tổng thực trả / 10.000)` điểm **một lần trên đơn gốc** khi nhân viên xác nhận đã thanh toán. Tổng chi, số đơn, ngày đến cuối và lịch sử lưu ở D1. Ngưỡng Member 0, Silver 100, Gold 300, Platinum 600. Màn hình khách xem điểm/lịch sử; POS tra số điểm. |
| Kho | 13 món và định lượng của 9 nguyên liệu chuyển từ POS offline; nhập, kiểm kê cộng/trừ, lên lịch nhận hàng; đơn QR/POS trừ tồn bằng trigger D1 trong chính giao dịch tạo/sửa đơn. Hủy đơn hoặc hủy phần chưa trả tiền cộng lại; tách bill và thanh toán không trừ hai lần. Dữ liệu tồn **khởi đầu bằng 0**: phải điền **số thực tế** cho cả số phần món và nguyên liệu trước khi nhận đơn. |
| Hoàn tiền | Chỉ chủ tiệm/quản lý được ghi khoản đã hoàn sau khi trả tiền thực tế; hoàn một phần hoặc toàn bộ, đơn tách bill chọn đúng bill, không vượt tiền đã thu, gửi lại cùng mã giao dịch không ghi trùng. Điểm và tổng chi hội viên giảm theo số tiền ròng. Hàng chỉ nhập lại kho khi chọn rõ món/số phần và xác nhận hàng còn nguyên. Không có chuyển khoản hoàn tự động. |
| Nhiều cấp quyền | OWNER (tài khoản `huang`), MANAGER, CASHIER, KITCHEN và vai trò tùy chỉnh. Chủ tạo/sửa tài khoản và quyền trên D1. API kiểm tra quyền của phiên tại máy chủ; APK chỉ nhận quyền qua HTTPS từ Worker, không dùng mật khẩu/quyền của POS offline. Phiên chung của bản cloud cũ bị buộc đăng nhập lại sau migration. |

SMS OTP và hóa đơn điện tử chưa chuyển. Điểm quá khứ trong app **offline** chưa được nhập vào D1; xem mục “Dữ liệu hội viên cũ”. Voucher mẫu mặc định tắt; voucher hội viên yêu cầu phone verified khi `ALLOW_UNVERIFIED_MEMBER_VOUCHERS` không được bật, hiện chưa tích hợp OTP.

## Cấu hình Cloudflare qua dòng lệnh (chỉ dành cho người phát triển; chủ tiệm dùng hướng dẫn web ở trên)

1. D1 tên `pos_unified`, ID `4a07644e-6038-4482-a90f-e55c6c2ebd8d`, binding `DB` đã điền trong [`wrangler.jsonc`](wrangler.jsonc) theo ảnh mày gửi. Nếu Cloudflare báo khác các giá trị này thì dừng để kiểm tra đúng tài khoản và database.
2. Đối chiếu migration: `npx wrangler d1 migrations list DB --remote`. Files [`migrations/0003_pos_cloud.sql`](migrations/0003_pos_cloud.sql), [`migrations/0004_loyalty_points.sql`](migrations/0004_loyalty_points.sql) và [`migrations/0005_inventory_refunds_roles.sql`](migrations/0005_inventory_refunds_roles.sql) **nằm ngay trong repo này**, cùng `0001` và `0002`. Chạy từ thư mục có `wrangler.jsonc`: `npx wrangler d1 migrations apply DB --remote`. Wrangler áp các file chưa chạy theo thứ tự; D1 trống theo ảnh sẽ chạy `0001` tới `0005`. Nếu DB lúc chạy đã có bảng không được quản lý bởi `d1_migrations`, dừng và đối chiếu trước khi áp. `0005` giữ nguyên đơn cũ (`inventory_tracked=0`), không trừ lại kho của các đơn đó, xóa các phiên POS cloud cũ để đăng nhập lại và tạo kho với tồn khởi đầu 0. Chỉ đơn mới (hoặc đơn cũ được thêm món) bắt đầu dùng kho; chuẩn bị tồn thực tế trước khi mở bán.
3. Tạo hai Worker **secrets** trong Settings → Variables and Secrets của đúng Worker `pos-unified`: `SESSION_SECRET` (giá trị ngẫu nhiên tối thiểu 32 ký tự) và `POS_STAFF_PASSWORD` (tạm `123456` theo yêu cầu UAT). Chọn **Secret** cho cả hai, bấm Deploy. **Không commit mật khẩu vào GitHub, APK, `wrangler.jsonc` hoặc URL QR**. Đổi mật khẩu sáu chữ số trước khi dùng thật. Nhân viên đăng nhập bằng tài khoản trên cloud; APK không hỏi thêm mật khẩu chủ tiệm cục bộ.
4. `wrangler.jsonc` đã bật `ORDERING_ENABLED=true` theo yêu cầu. BIN OCB `970448`, tài khoản `609271`, chủ tài khoản `HUANG TIANSHENG` nằm trong `vars` vì sẽ hiện công khai trên QR; **quét kiểm tra người thụ hưởng và số tiền bằng app ngân hàng trước khi nhận tiền thật**. Worker trả `acceptingOrders:false` nếu thiếu SESSION_SECRET, binding DB, hoặc migration `0005`. Dù `acceptingOrders:true`, món vẫn hiển thị hết hàng tới khi nhập tồn thật vào mục **Kho** trong `/staff/`.
5. Kết nối repo với Worker `pos-unified` trong Cloudflare Workers Builds; root repo `.` là thư mục chứa `wrangler.jsonc`. Build command `npm test`, deploy command `npx wrangler deploy`. **Migrations D1 không tự chạy khi GitHub deploy**: sau khi upload repo, chủ tiệm chạy workflow `Initialize Lotus POS D1` thủ công một lần bằng GitHub Web, token chỉ có quyền Account → D1 → Edit. File `wrangler.jsonc` đặt `workers_dev:true` để mở URL production của Worker; xác minh công tắc Domains và `/api/health` sau deploy. APK v2.1.1 đã trỏ đúng URL `pos-unified.lgl247-ai.workers.dev`.

Không upload các file `.dev.vars`, `android/signing/`, `android/build/`, `android/dist/`, backup DB, source POS offline hoặc mật khẩu lên GitHub. Repo chứa QR khách, POS staff, Worker, migrations và test; APK UAT gửi riêng.

## Dữ liệu hội viên offline cũ

Quy tắc **tích điểm mới** đã chuyển lên cloud. Dữ liệu lịch sử của POS offline không tự đồng bộ: trong bản offline, khách và điểm được giữ trong `localStorage` khóa `lotus_pos_v12_unified_checkout_v2` trên **thiết bị gốc**; bản UAT offline có cả khách mẫu/điểm mẫu. Không chép các bản ghi demo đó vào D1. Muốn mang số dư thật qua, cần xuất/đưa file sao lưu dữ liệu thực từ máy gốc, đối chiếu từng số điện thoại với hội viên cloud, chốt ngày bắt đầu ghi nhận và nhập một lần với nhật ký kiểm tra để tránh cộng trùng. Không đọc hoặc ghi vào localStorage offline từ APK cloud.

## Kiểm tra sau triển khai

- `https://pos-unified.lgl247-ai.workers.dev/api/health` phải trả `version:"2.1.1"`, `d1:"ok"`, `acceptingOrders:true`. Thử đăng nhập POS trên `/staff/` và SUNMI, xem 13 SKU.
- Đăng nhập `huang` → **Kho**, nhập số phần món và số g/ml nguyên liệu thực tế (không nhập số demo). Kiểm tra hết kho trên QR, thêm/hủy món, lịch nhập chỉ cộng đúng một lần; bấm hoàn khi hàng nguyên vẹn mới cộng lại kho. Tạo hội viên thật, gọi 4 phần trên QR, nhận đơn/in phiếu bếp, thêm 1 phần/in phần bổ sung; tách 4 phần thành 4 bill ở đơn test khác. Kiểm tra bản APK 2.1.1 in SUNMI và bếp KV804 trên Wi-Fi, kể cả khi Internet dùng 4G. Thiếu giấy hoặc kết quả in `UNKNOWN` phải kiểm tra giấy trước khi bấm in lại.
- Tạo nhân viên CASHIER và KITCHEN; thử nút bấm của mỗi vai trò và gọi API sửa kho/hoàn tiền trái quyền phải nhận HTTP 403. Khóa tài khoản nhân viên thì token cũ không còn quyền.
- Thanh toán đủ, hoàn một phần rồi toàn bộ, thử hoàn trùng và hoàn vượt tiền đã thu; so điểm và tổng chi hội viên. Hoàn bill tách phải chọn đúng bill; việc ghi hoàn trên POS **không** chuyển khoản cho khách, phải thực trả trước khi xác nhận.
- Kiểm tra QR OCB, người nhận, đúng số tiền/nội dung và PNG. Bấm khách “đã chuyển”: điểm không thay đổi. Nhân viên xác nhận đủ tiền trên POS: tổng đơn sau voucher được cộng đúng `floor(total/10000)` một lần; bill tách chỉ cộng sau bill cuối; thử bấm trả tiền lại không thể cộng điểm lần hai. Thử mạng chập chờn, hai máy cùng thao tác, đăng nhập lại QR để thấy điểm/hóa đơn.
- Mọi thao tác in và cảm ứng trên máy thật cần UAT trước khi phát cho khách. Bản APK ký khóa UAT, **không dùng khóa này làm bản phát hành chính thức**.

## Local

```bash
cp .dev.vars.example .dev.vars  # đặt secret chỉ trên máy, không commit
npm install
npm run db:local
npm test
npm run dev
```

Build Android bằng Android SDK 35/JDK/SUNMI printerlibrary 1.0.18, dùng cùng keystore UAT của bản CloudPilot cũ khi nâng cấp: `LOTUS_KEYSTORE=/path/to/lotus-cloud-pilot-uat.jks ./android/build-local.sh`. Đổi signing key thì Android yêu cầu gỡ **CloudPilot UAT**, không phải POS offline. Android không cho phép ghi đơn khi mất Internet; ứng dụng không được lưu hàng đợi thanh toán ngoại tuyến gây trùng giao dịch. Dùng Workers Paid nếu PBKDF2 120.000 vòng gây quá giới hạn CPU ở Free; phải thử trên Worker thật.
