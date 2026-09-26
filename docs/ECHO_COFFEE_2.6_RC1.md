# Echo Coffee · bản chạy thử local 2.6.0-rc.1

Ngày chuẩn bị: 25/09/2026. Nguồn: Lotus POS 2.5.1 người dùng gửi, POC `data/LotusPOS_POC_VN_CN_FnB_v10_MEMBER.html`, TXT `data/Echo_Coffee_POS_Menu_Import.txt` và logo jpg người dùng gửi.

## Mở bản thử

```bash
npm install
npm run db:local
npm run dev
```

Tạo `.dev.vars` từ `.dev.vars.example` với secret riêng cho môi trường thử, rồi mở `/counter/`, `/qr/?table=T01`, `/staff/`, `/display/` qua URL local của Wrangler. Nếu chỉ cần thử API với cơ sở dữ liệu **trong bộ nhớ**, chạy `node tests/dev-server.mjs`: cửa hàng Echo Coffee, toàn bộ migrations 0001–0011, POS demo `huang`, mật khẩu thử được định nghĩa ngay trong `tests/dev-server.mjs`; dữ liệu của server này mất khi dừng. `/counter/poc/` vẫn là mẫu HTML bất biến, **không** ghi D1.

**Không đưa trực tiếp gói này lên Worker đang bán.** D1 thật trước đó mới được xác nhận đến 0008; đối chiếu migration history và bản sao khôi phục trước mọi bước trên môi trường thật. Thứ tự mới là 0009 → 0010 → 0011. Riêng 0009 có script/workflow nâng cấp an toàn trong gói gốc. Gói này chưa thực thi GitHub Action, Cloudflare, hoặc sửa D1 của quán.

## Mức đối chiếu POC

| POC gốc | Quầy D1 local hiện nay | Còn thiếu để gọi là clone hoàn chỉnh |
| --- | --- | --- |
| Dashboard với bar, donut, forecast, top món, ca/chấm công | Biểu đồ SVG dùng khoản đã thu/hoàn theo giờ Việt Nam từ D1; CSV và bản in PDF qua trình duyệt | Kiểm ảnh/bố cục chính xác theo POC trên trình duyệt thực; thử dữ liệu nhiều ngày và PDF thực |
| Quản lý ca → tổng quan, chấm công, lịch nhập, xin nghỉ, checklist, lịch ca/OT/đổi ca, bàn giao, lịch sử | Có đủ 8 nhánh, ghi/đọc D1; quản lý duyệt, nhân viên nhận đổi ca, bàn giao có xác nhận, lịch tuần và chống trùng ca | Kiểm từng trường, trạng thái và kiểu trình bày song ngữ so với POC; hạn mức nghỉ phép chưa có cấu hình |
| Bán hàng và menu Echo Coffee | 85 SKU giá đúng TXT; 68 món, nhóm chọn sốt/combo/topping; quầy/QR dùng giá từ Worker; máy cầm tay cùng JS quầy | Chưa có ảnh từng món; TXT chỉ ghi tên tệp ảnh mà không kèm tệp ảnh; quầy chưa khớp từng pixel POC |
| Quản lý tiệm, logo và thiết bị | Logo Echo JPEG trên quầy, QR và màn hình phụ, có thể thay logo JPG/PNG trong Quản lý tiệm; cài bridge/in và D1 giữ cấu hình | Nút và bố cục của toàn bộ POC preview chưa nối lại vào quầy thật; chưa thử phần cứng quán |
| Khách hàng/Member trong sidebar POC | Tìm, đăng ký, đăng nhập hội viên khi lập đơn; QR đăng nhập và điểm thành viên | **Chưa có màn Khách hàng riêng** với bảng, email, ngày sinh, hạng tùy chọn, ghi chú như POC |
| QR Order trong POC | Danh sách đơn QR, nhận đơn, thanh toán qua API | Khu gọi nhân viên và mã thanh toán chờ quét của POC chưa có luồng D1 tương ứng |
| Các chức năng POC còn lại | Sản phẩm, kho, voucher, lịch sử, quyền, màn hình phụ, chia/gộp bill, hoàn tiền, license mô phỏng có luồng D1 của 2.5.1 | Cần map từng nút/trường của bản POC và thử ít nhất 80 tình huống **trên bản POC thật đã nối D1** trước khi thay `/counter/` |

## Dữ liệu và điều kiện an toàn

- `0010_shift_ops.sql`: bảng giao hàng, phép, task, OT, đổi ca, bàn giao, sửa công; `request_key` chống ghi trùng và được giữ nguyên khi quầy mất phản hồi mạng; version tránh ghi đè; trigger D1 chặn duyệt nghỉ trùng lịch, xếp lịch khi nghỉ, đổi ca vào lịch trùng và sửa công đã thay đổi.
- `0011_echo_menu.sql`: bổ sung 85 SKU và modifier; chỉ ngừng bán 13 món demo PT nếu chưa bị quản lý sửa từ bản seed. Giá/snapshot đơn cũ, khách và nhật ký kho vẫn tồn tại. Tên quán/logo mặc định chỉ được thay nếu cấu hình vẫn nguyên seed ban đầu. Nếu quán đã tự chỉnh cấu hình, đặt tên/logo qua Quản lý tiệm.
- 5 topping có giá cộng riêng: Kem Sữa 16.000đ; 4 topping còn lại 10.000đ. Combo cơm chọn 1 cơm + 1 trà, gà giòn sốt chọn 1 sốt; Worker kiểm lựa chọn và tính tiền lại. Giá M/L là **hai SKU riêng** đúng theo TXT, không cộng thêm lần nữa khi chọn size.
- Tên tiếng Trung của Bạc xỉu và Kem Trứng giữ nguyên TXT người dùng; cần xác nhận với tiệm trước khi công bố menu chính thức.
- Dashboard forecast minh họa: hồi quy tuyến tính 7 ngày thực thu (trừ hoàn), dự báo 3 ngày, chỉ hiển thị khi có ≥3 ngày có khoản thu. Không phải dự báo được kiểm định thống kê. Tên/logo phụ thuộc vào cài đặt mỗi tiệm; không ghi bí mật trong repo.

## Kiểm thử đã chạy và giới hạn

`npm test`: 209/209 phép thử qua trên Node 24 và SQLite local. Thêm 3 bài kiểm 0001–0011: menu và giá chống giả mạo, thanh toán rồi dashboard; giao hàng/phép/đổi ca/task/OT/bàn giao/sửa công và kiểm SQL nguyên tử; đủ 8 màn ca và ba dạng đồ thị render. 206 bài cũ tiếp tục chạy trên schema tương ứng, trong đó ma trận chéo cũ dùng chủ yếu 0001–0008. Migration 0010–0011 được áp sạch bằng SQLite trong bộ test. **Chưa** kiểm Cloudflare D1 thật, bố cục bằng ảnh từ trình duyệt (trình duyệt từ xa chặn localhost), 80 case trên POC đã nối D1, máy in/két/tem/SUNMI tại quán, hay APK đã ký.
