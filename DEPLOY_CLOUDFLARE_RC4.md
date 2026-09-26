# Deploy Echo Coffee POS 2.6.0-rc.4 lên Cloudflare

Gói này chứa toàn bộ source Worker `pos-unified`, bốn UI, 13 migration, workflow nâng D1 và workflow deploy thủ công. **Không tải nguyên ZIP lên GitHub**: giải nén rồi đưa nội dung thư mục `LotusPOS_2.6.0-rc4/` vào **gốc** repo `pos-unified` theo đúng đường dẫn. `.github/workflows/` phải được giữ lại. Không đưa `.dev.vars`, token, khóa máy in hoặc mật khẩu vào repo.

## Bước 1 · Kiểm D1 thật trước khi đẩy Worker

Trong Cloudflare D1 `pos_unified`, sao lưu DB rồi chạy **chỉ đọc**:

```sql
SELECT name FROM d1_migrations ORDER BY id;
```

Không suy đoán trạng thái từ 305 bài test local. Theo thông tin bàn giao trước, D1 thật mới xác nhận đến 0008. Nếu đúng là đến 0008, dùng workflow sẵn `Upgrade Lotus POS D1 0009 - Sales independent from inventory` để áp **0009**. Script nâng cấp riêng này có kiểm tra trạng thái và giữ tồn đã ghi; chờ workflow báo thành công. Sau đó chạy workflow mới **Upgrade Lotus POS D1 0010 through 0013**. Workflow này từ chối chạy nếu 0009 chưa hoàn tất, áp 0010 → 0013, rồi kiểm lại 13 migration và 85 SKU Echo. Nếu lịch sử D1 không đúng 0001–0008 hoặc đã có một phần migration mới, dừng và đối chiếu với backup trước khi áp tiếp.

Có thể thao tác bằng terminal với cấu hình Wrangler/Cloudflare đã đăng nhập:

```sh
node scripts/upgrade-d1-0009.mjs
npm run db:remote
npm run check:d1
```

Lệnh đầu cần `CLOUDFLARE_ACCOUNT_ID` và `CLOUDFLARE_API_TOKEN`; chỉ dùng khi lịch sử đến đúng 0008. Hai workflow dùng secret D1 hiện có `CLOUDFLARE_D1_API_TOKEN`. Lệnh `check:d1` chỉ đọc từ D1 thật; nó từ chối trạng thái thiếu migration, thiếu schema thanh toán hoặc thiếu menu.

## Bước 2 · Đưa source lên GitHub rồi phát hành

Tránh để kết nối tự deploy nhánh `main` chạy Worker mới trước khi D1 xong. Nếu repo đang bật auto deploy khi push, hoàn thành bước D1 trên nhánh chuẩn bị trước, rồi mới gộp bản rc.4 vào `main`. Sau khi D1 đã qua `check:d1`, có hai cách phát hành:

1. **GitHub Actions:** cấu hình secret `CLOUDFLARE_POS_DEPLOY_TOKEN` có quyền đọc D1 và phát hành Worker. Vào Actions → **Deploy Lotus POS rc.4 to Cloudflare** → Run workflow trên commit rc.4. Workflow chạy `npm test`, kiểm D1 thật, deploy Worker cùng thư mục `public/`, rồi gọi `/api/health` năm lần để kiểm `version: 2.6.0-rc.4`, `d1: ok`, `echoReady: true`, `acceptingOrders: true`.
2. **Terminal trên máy có Wrangler và token:** `npm install`, `npm test`, `npm run check:d1`, `npm run deploy`, `node scripts/check-cloud-health.mjs`. Không bỏ qua bước kiểm D1. `wrangler.jsonc` đã trỏ Worker `pos-unified` và D1 `pos_unified`.

Các file như `node_modules/`, log local, ZIP cũ, ảnh UAT riêng không cần đưa vào repo. Nếu Cloudflare đang auto deploy sau push, workflow thủ công sẽ deploy lại cùng commit sau khi đã qua cổng kiểm D1. Worker sẽ từ chối nhận đơn mới khi schema chưa đủ; tránh để quán rơi vào tình trạng này bằng cách nâng D1 trước.

## Bước 3 · Kiểm tại quán

Mở `/qr/?table=T01`, `/counter/`, `/staff/`, `/display/`. Khách chọn tiền mặt/chuyển khoản, gọi món và thông báo nhân viên; quầy hiện yêu cầu bàn; nhân viên xác nhận đã nhận tiền; chỉ lúc đó phiếu bếp xuất. Kiểm QR chuyển khoản, biên nhận, tem/barcode trên giấy, két tiền, reload và mất mạng thực tế. Sidebar quầy không còn mục License POC. Những việc này **chưa được nghiệm thu trên D1 và thiết bị thật**; 80 case mới không được cộng vào ngưỡng 80 case UAT chéo có bằng chứng thật.

Nếu health chưa đạt, giữ log workflow và kết quả `SELECT name FROM d1_migrations ORDER BY id;` để khoanh vùng. Có thể khôi phục bản Worker trước trong Cloudflare Deployments; không xóa hoặc tạo lại D1 vì còn đơn, hội viên và tồn kho.
