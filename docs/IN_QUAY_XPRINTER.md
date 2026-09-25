# Lắp máy in, két và máy quét cho POS quầy 2.5.0

## Sơ đồ ở cửa hàng

| Thiết bị | Kết nối tại quầy | Chức năng |
| --- | --- | --- |
| XP-Q200 80 mm có cổng LAN | Cùng mạng nội bộ với máy Windows quầy, TCP 9100 (kiểm tra port thực tế) | Hóa đơn sau thanh toán, cắt giấy |
| XP-365B | USB cắm **máy Windows quầy**, đã cài driver và hiện tên trong Devices and Printers | Tem từng phần ăn trên phiếu bếp (kể cả món thêm) |
| Két tiền | Dây két vào cổng DK/RJ11 hoặc RJ12 của **XP-Q200** (đúng điện áp/đầu nối máy thực tế) | XP-Q200 nhận lệnh `ESC p 0 25 250` qua LAN và kích két sau thanh toán tiền mặt |
| Màn hình thứ hai | Trình duyệt trên màn hình phụ, mở link quầy cấp | Giá và trạng thái đơn từ D1, không cần cắm vào cầu in |
| Máy cầm tay SUNMI/KV804 | Wi-Fi hoặc 4G + máy in đã thử tại tiệm | In bếp và bill theo cấu hình APK hiện có, độc lập ba thiết bị trên |
| Máy quét USB/Bluetooth HID | Cắm USB hoặc ghép Bluetooth với máy quầy/cầm tay | Đưa con trỏ vào ô **Máy quét mã** trong POS rồi quét, máy gửi mã và Enter như bàn phím |
| Máy quét LAN TCP | IP riêng trong LAN, chỉ nhận từ IP đã khai báo trên máy Windows quầy | Nhận mã bàn/đơn/SKU/hội viên ở cổng máy quét cấu hình trong **Thiết bị** |

**Cloudflare Worker không truy cập được IP nội bộ và cổng USB của quầy.** `bridge/start-counter.cmd` khởi động cầu in trên máy Windows tại quầy; trình duyệt POS chỉ giao tiếp với `127.0.0.1:18181`. Cầu in không mở cổng mạng cho thiết bị khác. Trước khi in hóa đơn/mở két, cầu in dùng phiên POS để truy vấn D1 qua Worker và kiểm tra bill `PAID`; két chỉ nhận bill `CASH`.

## Cài tại quầy, không nhập lệnh

1. Lắp USB XP-365B và driver, kiểm tra Windows **Devices and Printers** có đúng tên máy in. XP-Q200 phải có cổng LAN đúng phần cứng, in trang cấu hình để biết IP thực tế; đổi IP về cùng dải LAN với Windows. Cắm két vào cổng két của Q200. Đặt khổ/gap tem theo cuộn tem thật và hiệu chỉnh cảm biến bằng nút máy theo tài liệu thiết bị.
2. Cài **Node.js LTS** trên máy Windows quầy (một lần), giải nén gói `LotusPOS_v2.5.0_Cau_in_Windows.zip` ra một thư mục giữ nguyên. Không chạy cầu in qua Cloudflare. Nhấp đúp `start-counter.cmd`, **giữ cửa sổ mở** trong suốt ca. Trình duyệt tự mở `http://127.0.0.1:18181/setup`.
3. Tại trang thiết lập cục bộ, chọn Q200 kết nối **LAN / Windows USB / Bluetooth đã ghép Windows** và điền IP + port hoặc chính xác tên máy in trong Windows; chọn XP-365B kết nối **USB / LAN nếu có cổng / Bluetooth đã ghép**. Điền chiều rộng, cao và gap tem theo cuộn đã lắp (mặc định 50 × 30 mm, gap 2 mm chỉ là mẫu). Chọn máy quét HID hoặc LAN; LAN cần IP nguồn của máy quét và cổng nhận trên máy quầy. Bấm **Lưu cấu hình**.
4. Chép **mã ghép** trên trang cục bộ. Vào [POS quầy](https://pos-unified.lgl247-ai.workers.dev/counter/) bằng Chrome/Edge trên **cùng máy Windows** → đăng nhập **OWNER** → **Thiết bị** → dán mã → **Ghép cầu in**. Cho phép quyền **truy cập mạng cục bộ** khi trình duyệt hỏi. Từ đó mọi thiết lập Q200, XP-365B và máy quét sửa ngay ở form **Thiết bị** trên POS quầy, được lưu trên chính máy Windows. Bấm **Kiểm tra cầu in**; trạng thái này chỉ xác nhận dịch vụ đang chạy và cấu hình đã lưu, không xác nhận máy còn giấy.
5. Lấy **đơn thử đã thanh toán thật** (hoặc đơn kiểm thử đúng quy trình tại tiệm), in một bill tiền mặt: xem hóa đơn Q200, dao cắt, két mở đúng **một lần**. In tem theo phiếu bếp, đối chiếu mỗi phần ăn một tem và canh vị trí. Với bill chuyển khoản đã xác nhận, chỉ có hóa đơn và két không mở. Thử thêm món rồi in tem phiếu mới: không tự in lại món cũ. Ghép màn hình thứ hai và kiểm tổng tiền sau khi thêm món/thanh toán.
6. HID: đưa con trỏ vào ô máy quét ở màn hình Bán hàng/Đơn hàng/Kho, quét mã, nhấn Enter nếu máy không tự gửi Enter. LAN: dùng IP nguồn trong cấu hình máy quét, mở cổng nhận chỉ cho máy quét trên Windows Firewall; quét bàn, mã đơn, SKU và số điện thoại thành viên. Máy quét chỉ tra cứu/đưa vào giỏ, không tự thu tiền hay tự ghi nhập kho.

Nếu mất mạng: khoản thanh toán được ghi trên D1 trước khi ra lệnh in/két. Nếu gửi lệnh lỗi hoặc không rõ kết quả, POS báo **đã lưu thanh toán** và hiển thị nút **Kiểm tra / in hóa đơn** cùng **Mở két lại · quản lý** cho bill tiền mặt. Kiểm tra giấy và két thực tế trước khi thao tác lại. **In qua trình duyệt** là dự phòng, không kích két. Cầu in lưu mã công việc đã gửi vào `jobs.local.json` và không tự chạy lại sau khi khởi động lại; các trạng thái `SENT`/`UNKNOWN` chỉ nói về việc đã gửi lệnh, không bảo đảm giấy đã ra. Không xóa `config.local.json` hoặc `jobs.local.json` khi đang dùng; chúng chỉ nằm trên Windows và không upload GitHub. Cấu hình giấy kẹt, nắp mở, hết giấy/đầu in nóng phải xử lý trên máy in và đối chiếu giấy thực tế; firmware có thể không trả trạng thái phần cứng qua TCP hoặc spooler.

## Phạm vi phiên bản

2.5.0 thêm migration `0008_store_config.sql` và giao diện **Quản lý tiệm** lưu ngân hàng, thuế, logo trên D1. Máy cầm tay vẫn in riêng qua SUNMI/KV804; APK Cloud 2.3.0 có thể gọi Worker mới nhưng hóa đơn native cũ chưa in dòng thuế. Chưa có APK 2.4.0 ký UAT trong gói, muốn cài đè Cloud APK cần đúng khóa ký UAT cũ. Trình duyệt quầy phải chạy trên **máy Windows nối USB tem**; nếu quầy thực tế chạy Android/Linux thì cần cầu in tương ứng, không thể chỉ cài file `.cmd` lên máy đó.
