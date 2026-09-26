# Lotus POS 2.5.1 · Quy tắc kho độc lập với bán hàng

Đây là bản chuẩn bị; chưa tự cập nhật hệ thống đang bán của khách. Các bước đều thực hiện trên GitHub Web và Cloudflare Web, không dùng PowerShell.

1. Trước khi thay đổi, mở Cloudflare → D1 `pos_unified` → Time Travel, ghi lại thời điểm/đánh dấu khôi phục. Kiểm tra D1 Console: `SELECT name FROM d1_migrations ORDER BY id;` — phải có 8 dòng, cuối là `0008_store_config.sql`.
2. Tải lên GitHub repo `LGL-AI/pos-unified` ba tệp đúng đường dẫn: `migrations/0009_sales_independent_inventory.sql`, `scripts/upgrade-d1-0009.mjs` và `.github/workflows/upgrade-d1-0009.yml`; commit lên `main`. Không tạo lại D1, không xóa 0001–0008.
3. GitHub → Actions → **Upgrade Lotus POS D1 0009 - Sales independent from inventory** → **Run workflow** trên `main`. Chờ dấu xanh. Nếu đỏ, **dừng tại đây**, chụp log, không cập nhật Worker; chạy lại cùng workflow sau khi xác định lỗi, script tự kiểm tra trạng thái từng bước.
4. Cloudflare → D1 `pos_unified` → Console → chạy lại `SELECT name FROM d1_migrations ORDER BY id;`. Chỉ đi tiếp nếu có 9 dòng và dòng cuối `0009_sales_independent_inventory.sql`.
5. Sau khi đã xong D1, tải lên GitHub Web các tệp Worker/UI/test trong bản phát hành 2.5.1, commit `main`, chờ Cloudflare build xanh. Mở `/api/health`, kiểm tra `"version":"2.5.1"` và `"d1":"ok"`.
6. Kiểm tra một món đang bật nhưng tồn bằng 0 trên QR và quầy; chốt một đơn thử theo quy trình quán, xem đơn có vào D1/POS, xem phiếu bếp, kiểm tra `Tồn ghi sổ` không bị đơn hàng thay đổi và `ước tính` có thể xuống âm. Hủy đúng đơn thử nếu cần; không nhập giả nguyên liệu để mở bán.

Lưu ý: đã đối chiếu file HTML POC gốc và dựng lại một số màn quầy (sidebar, bán hàng, tìm kiếm/danh mục, bảng lịch ca tuần). Chưa chuyển tất cả module demo của POC (OT, đổi ca, phép, checklist…) sang D1; đừng dùng bản này để giả định đã có các thao tác đó. Trước khi áp ở quán thật, xem giao diện quầy thực tế trên máy quầy và thử nhập/bán/in ở môi trường của quán.
