# Lotus POS 2.1.1: cài bằng GitHub Web và Cloudflare Web

Không cần PowerShell. Repo: [`LGL-AI/pos-unified`](https://github.com/LGL-AI/pos-unified); Worker: `pos-unified`; D1: `pos_unified`, ID `4a07644e-6038-4482-a90f-e55c6c2ebd8d`; website: <https://pos-unified.lgl247-ai.workers.dev>.

Ngày 24/09/2026, sau lỗi `incomplete input` khi dán SQL gộp, câu SELECT kiểm tra lại cho kết quả **không có bảng hoặc trigger ứng dụng**. Có thể cài cả năm migration qua nút chạy thủ công GitHub Actions. **Không dán lại tệp SQL gộp vào D1 Console.** Nếu trong lúc làm database xuất hiện bảng ứng dụng trước bước chạy Actions, gửi ảnh để kiểm tra trước khi bấm chạy.

## Bước 1 — Đưa bản mã nguồn mới lên GitHub

1. Tải `LotusPOS_Unified_v2.1.1_GitHub_Source.zip` trong tin nhắn, **giải nén**. Mở thư mục vừa giải nén tới chỗ thấy `wrangler.jsonc`, `package.json`, `src/`, `public/`, `migrations/` và `.github/`. Không tải ZIP hay APK lên GitHub.
2. Mở [GitHub repo](https://github.com/LGL-AI/pos-unified) → chọn nhánh mặc định (thường là `main`) → **Add file → Upload files**. Kéo thả **toàn bộ nội dung bên trong** thư mục vừa giải nén vào trang upload, rồi **Commit changes**. Nếu trình duyệt không mang theo thư mục ẩn `.github`, làm theo bước 3.
3. Kiểm tra ngay trên trang repo có `wrangler.jsonc` ở **gốc**, năm tệp `migrations/0001_…` đến `0005_…`, và `.github/workflows/initialize-d1.yml`. Nếu **thiếu workflow**, vào **Add file → Create new file**, gõ đúng tên `.github/workflows/initialize-d1.yml`, mở tệp cùng tên ở gói ZIP, sao chép **toàn bộ** nội dung vào khung rồi bấm **Commit changes**. Nút **Run workflow** chỉ có khi tệp này nằm trên **nhánh mặc định**.
4. Nếu repo còn `wrangler.toml` hoặc `wrangler.json` ở gốc từ lần trước, xóa tệp cấu hình cũ trên GitHub Web (mở tệp → dấu ba chấm → **Delete file** → commit), để chỉ có `wrangler.jsonc`. Nếu không chắc tệp nào là cấu hình cũ, gửi ảnh danh sách gốc repo trước khi xóa.

## Bước 2 — Cấp quyền D1 cho nút chạy trên GitHub

1. Mở [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token → Custom token → Get started**. Đặt tên `Lotus POS D1 migration`; phần **Permissions** chọn **Account → D1 → Edit**; phần **Account Resources** chỉ chọn tài khoản đang chứa D1 `pos_unified`. Bấm **Continue to summary → Create token** rồi **Copy**. Chỉ cần tạo **một lần**.
2. Mở [Settings của repo GitHub](https://github.com/LGL-AI/pos-unified/settings) → bên trái **Secrets and variables → Actions** → **New repository secret**. Đặt **Name** chính xác `CLOUDFLARE_D1_API_TOKEN`, dán token vừa sao chép vào **Secret**, rồi **Add secret**. Không đưa token vào mã nguồn, tin nhắn hay ảnh chụp màn hình.
3. Account ID đã có sẵn trong workflow; nó không phải mật khẩu. Token này chỉ để cài D1; Worker đang nối GitHub sẽ deploy qua Cloudflare Builds riêng.

## Bước 3 — Bấm nút cài database

1. Trên [repo](https://github.com/LGL-AI/pos-unified), bấm **Actions** → **Initialize Lotus POS D1** ở cột trái → **Run workflow** ở bên phải → chọn nhánh mặc định đã upload → bấm **Run workflow** màu xanh.
2. Chờ lần chạy mới hiện **dấu tích xanh**. Bấm vào lần chạy đó → **Apply D1 migrations to pos_unified** → xem bước **Print migration history**: phải có đủ `0001_initial.sql`, `0002_customer_members_vouchers.sql`, `0003_pos_cloud.sql`, `0004_loyalty_points.sql`, `0005_inventory_refunds_roles.sql`. Bước **Confirm there are no unapplied migrations** phải thành công.
3. Qua Cloudflare **Storage & databases → D1 SQL Database → pos_unified → Console**, chạy câu kiểm tra ngắn sau; cần thấy **5**:

   ```sql
   SELECT COUNT(*) AS applied FROM d1_migrations;
   ```

   Nếu Actions báo đỏ hoặc số khác 5, **không chạy SQL cũ, không nhận đơn thật**. Mở bước màu đỏ, gửi ảnh **phần lỗi** cho tao (che API token nếu vô tình hiện ra). Wrangler lưu lịch sử và bỏ qua migration đã áp, nên tao sẽ đối chiếu lỗi trước khi chọn bước tiếp theo.

## Bước 4 — Đặt secret cho Worker và kiểm tra website

1. Cloudflare → **Workers & Pages → pos-unified → Settings → Variables and Secrets → Add**. Tạo `SESSION_SECRET` loại **Secret**, dùng chuỗi ngẫu nhiên từ trình quản lý mật khẩu **ít nhất 32 ký tự**. Tạo `POS_STAFF_PASSWORD` loại **Secret**, tạm nhập `123456` như đã thống nhất. Bấm **Save/Deploy** nếu trang yêu cầu. Đây là **secret Worker**, khác secret GitHub vừa đặt.
2. Trong **Settings → Builds**, kiểm tra repo kết nối là `LGL-AI/pos-unified`, root là gốc repo (`.` hoặc trống), **Build command** `npm test`, **Deploy command** `npx wrangler deploy`. Đây là nội dung ô cài đặt trên Cloudflare; mày không phải chạy lệnh. Mở **Deployments/Builds** để xem lần build theo commit mới nhất báo **Success/Deployed**. Nếu vẫn báo **Latest build failed**, mở **Build logs**, gửi ảnh dòng lỗi đầu tiên.
3. Trong **Domains**, bật công tắc **Production** cho `pos-unified.lgl247-ai.workers.dev` nếu đang tắt. Mở [kiểm tra sức khỏe](https://pos-unified.lgl247-ai.workers.dev/api/health): phải thấy `"version":"2.1.1"`, `"d1":"ok"`, `"acceptingOrders":true`. Nếu chưa thấy đủ, gửi ảnh kết quả; đừng cho khách đặt đơn lúc này.

## Bước 5 — Nhập kho, thử đơn và cài APK

1. Mở [POS nhân viên](https://pos-unified.lgl247-ai.workers.dev/staff/) → đăng nhập `huang` / `123456` → **Kho** → nhập tồn **thực tế** cho món và nguyên liệu. Kho khởi đầu bằng 0; khách sẽ thấy hết hàng cho đến khi nhập kho.
2. Thử [QR của bàn T01](https://pos-unified.lgl247-ai.workers.dev/?table=T01) trên điện thoại; thử đặt, thêm món, voucher, thành viên, tách bill và thanh toán. Đối chiếu QR OCB `609271` / `HUANG TIANSHENG` và đúng số tiền bằng ứng dụng ngân hàng; nhân viên kiểm tra tiền thực nhận rồi xác nhận trên POS. Thử in hóa đơn và phiếu bếp.
3. Khi web đã chạy, cài APK cloud 2.1.1 trên SUNMI, thử lại in SUNMI và KV804 trên máy thật. APK cloud cài cạnh POS offline; SUNMI cần Internet để ghi đơn, máy in KV804 cần Wi-Fi nội bộ.
4. Đổi `POS_STAFF_PASSWORD` sáu chữ số thành mật khẩu dài trước khi cho nhân viên/khách dùng rộng rãi.

Nếu mắc ở bước nào, gửi ảnh **đúng màn hình đang lỗi**; che token và `SESSION_SECRET`.
