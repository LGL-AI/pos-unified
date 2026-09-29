# RC5.1 Counter P0.8 — kết quả kiểm thử chéo

## Kết luận

Đã chạy lại 327/327 test tự động thành công, gồm bộ nghiệp vụ cũ và test bổ sung
cho quyền, tách 3 bill qua nhiều tài khoản, tăng ca, phản hồi mạng bị treo,
đồng bộ lịch đang mở, nguồn cập nhật màn khách và thứ tự in web.
Đã build APK version code 10, target API 30, cùng khóa ký bản P0.7.
Đã chạy PrintFlowSimulation trên JVM: thứ tự tem → bếp/cắt → hóa đơn/cắt;
khi bếp chưa gửi thành công thì không gọi bước hóa đơn.

Không ghi dữ liệu thử lên Cloudflare production. Worker được chạy bằng mã thật
với SQLite adapter cho D1; UI handlers chạy trong DOM giả lập. Đây không phải
Android Emulator, trình duyệt render thật hoặc máy in thật. Không khẳng định
327 test đồng nghĩa đã hết đơ/cắt chữ trên máy khách.

## Lỗi tìm thấy và sửa

| Vấn đề | Thay đổi P0.8 | Bằng chứng |
|---|---|---|
| POS web gửi hóa đơn trước phiếu bếp | Tem → bếp → hóa đơn; giữ hóa đơn nếu trạng thái bếp chưa rõ | Test thứ tự gửi, mô phỏng mất kết nối bếp sau thanh toán; D1 vẫn PAID, không gửi hóa đơn |
| Tăng ca trùng ca thường vẫn duyệt được | Kiểm tra xung đột trong cùng lệnh UPDATE; chặn trùng OT đã duyệt, nghỉ phép; chặn xếp ca thường đè OT | Test tái hiện lỗi trước sửa, qua sau sửa; cho phép ca liền kề |
| Duyệt nghỉ/đổi ca có thể đè OT đã duyệt | Thêm điều kiện vào lệnh duyệt | Kiểm tra mã và hồi quy ca/nghỉ/đổi ca; chưa có mô phỏng tranh chấp D1 phân tán |
| Lịch đang mở không tự nhận thay đổi | Đưa lịch/attendance/shift ops vào vòng đồng bộ 10 giây | Tạo lịch từ terminal khác rồi kiểm tra UI đang mở nhận lịch |
| Đọc chi tiết đơn nền có thể đổi màn khách | Bỏ displayOrder khỏi fetch observer; UI hiện hành quản lý snapshot | Test GET nền không gọi đổi màn; POST pay vẫn gọi bridge in |
| HTTP trả headers nhưng kẹt body có thể chờ mãi | Timeout bao gồm đọc body ở POS và màn khách; màn khách không chạy poll chồng nhau | Test phản hồi body treo bị abort |
| Popup QR dùng inset trên WebView cũ | Dùng top/right/bottom/left, thêm fallback chiều cao viewport | Kiểm tra mã; chưa render trực tiếp trên WebView cũ |
| Phiếu in hiển thị JSON topping; tên tiếng Trung dài bị cắt ngang | Format tên tùy chọn VN/Trung; wrap theo chiều rộng đo bằng font; thêm tên Trung | Build Android thành công; cần xem giấy thật |
| Tem chỉ vẽ một dòng tên/ghi chú | Wrap theo khổ tem, giảm cỡ chữ có giới hạn; báo lỗi nếu vẫn không vừa, không âm thầm cắt mất ghi chú | Build Android thành công; cần kiểm thử khổ tem thực |
| Bridge Android có thể gửi tem trước bước kiểm tra quyền in bếp | Xác thực quyền PAYMENT_CONFIRM/PRINT_KITCHEN từ /me trước gửi tương ứng | Kiểm tra mã và build; chưa chạy native permission flow trên emulator |

## Các luồng đã kiểm tra

| Nhóm | Kết quả và giới hạn |
|---|---|
| Nhân viên / quản lý / chủ tiệm | Cashier bị từ chối tạo tài khoản, sửa món, tạo voucher, xếp ca trái quyền; manager và owner thực hiện luồng được cấp quyền. Backend kiểm quyền, không chỉ ẩn nút. Không phải kiểm hết mọi tổ hợp role tùy chỉnh. |
| QR → POS → tách bill | QR T07, cashier nhận đơn, manager tách 3 bill, 3 tài khoản thanh toán cash/bank. Tổng bill bằng tổng đơn. Bếp chỉ tạo 1 job khi bill cuối PAID. QR phải được nhận trước khi tách. |
| Bấm/gửi lặp | Gửi lại thanh toán không tạo thêm kitchen job; hai terminal tranh claim chỉ một terminal nhận. Mở/đóng popup nhiều lần, Back, Scanner, giữ cuộn menu có test handler. |
| Kho và gọi món | Kho thực và ước tính tách riêng. Món active vẫn gọi được khi kho thực bằng 0; nhập kho không phải điều kiện bắt buộc để bán. Chống ghi nhập kho lặp bằng idempotency. |
| Voucher | Tạo/sửa, quyền quản lý, điều kiện member, hạn mức, tối thiểu đơn, tính tiền phía server, gửi lại đơn không trừ lượt lần hai đã có test. Không thấy lỗi mới trong các ca đã chạy. |
| Ca / lịch / tăng ca | Xếp ca, đổi ca có đồng ý, duyệt nghỉ, chấm công, chỉnh công theo +07:00 và OT đều có test. OT hiện cùng ngày; ca qua nửa đêm chưa được hỗ trợ và không được coi là đã test thành công. |
| Màn khách | Snapshot giá do Worker tính, QR thanh toán, đã trả tiền, cập nhật từ POS khác có test logic. Presentation/màn hình Android thứ hai chưa chạy trực tiếp ở môi trường này. |
| Chữ/UI | Đã sửa điểm tương thích và dựng chữ in nêu trên. Chưa có bằng chứng hình ảnh ở từng kích thước/zoom/font thật; vẫn cần test ASUS và máy khách. |

## Lệnh in ở từng bước

| Bước | Hành vi hiện tại |
|---|---|
| Chọn món / QR gửi đơn / nhận đơn / thêm món chưa thu tiền | Không tự in bếp, tem, hóa đơn |
| Tách bill, chưa trả tiền | Không in |
| Trả một bill nhưng chưa hết đơn | In hóa đơn bill đã trả; chưa in bếp/tem toàn đơn |
| Trả bill cuối hoặc trả nguyên đơn | Tem máy riêng; bếp và cắt; hóa đơn và cắt |
| Không kết nối được máy in tem | Báo lỗi tem; bếp/hóa đơn vẫn có thể tiếp tục |
| Bếp FAILED/UNKNOWN | Giữ hóa đơn; không đánh dấu rằng đã có giấy thật; kiểm tra hàng đợi/giấy trước retry |
| Mất mạng sau ghi PAID | Không thu tiền hoặc tạo đơn mới để chữa lỗi in; tải lại đơn và đối chiếu trạng thái |
| Xem lại đơn / đọc chi tiết nền | Không tự phát lệnh in hóa đơn mới |
| Đơn trả tiền từ thiết bị khác | Poll quầy nhận job bếp/tem; không mặc định in lại hóa đơn đã in ở thiết bị thu tiền |

## Điểm còn mở — không được coi là đã giải quyết

1. **Tem nhiều quầy:** khóa chống lặp tem nằm ở từng trình duyệt/SQLite từng máy,
   chưa có claim tem toàn hệ thống như phiếu bếp. Nếu hai quầy/cầu in độc lập cùng
   bật auto-print, có nguy cơ in tem trùng. Đây là phát hiện qua rà mã, chưa chạy
   thực nghiệm hai thiết bị native. Cần quyền sở hữu job tem trên server trước khi
   cho nhiều máy cùng tự in; hiện chỉ nên để một quầy/cầu in đảm nhiệm tem.
2. **Không thể xác nhận giấy bằng kết quả gửi bytes:** SUCCESS/SENT chứng minh lệnh
   gửi thành công theo transport, không chứng minh máy có giấy hoặc cutter đã cắt.
   Không tự retry UNKNOWN vì có thể đã in rồi.
3. **Native runtime/UI thật chưa xác minh:** không có Android Emulator hoạt động
   ở môi trường này; trình duyệt local trước đó tải thất bại. Không phát hành với
   tuyên bố “không còn đơ”. Cần chạy checklist P0.7 trên ASUS và kiểm tra in giấy.
4. **Printer routing web:** thứ tự đã sửa, nhưng muốn bếp và hóa đơn chung một máy
   phải cấu hình routing tới đúng máy có cutter. Không thể tự kiểm IP/USB của khách.

## Cài và triển khai

- Cài đè LotusPOS_Counter_RC5_1_P08_Android11.apk lên P0.7, không xóa dữ liệu.
- Chép source ZIP vào repo GitHub hiện tại, xem git diff rồi commit/push để deploy
  Worker và assets. **Cần deploy source để nhận sửa tăng ca và QR/POS web.** APK chỉ
  cập nhật native cùng assets POS/màn khách được đóng gói.
- Không có migration DB mới cho P0.8; không sửa token, không xóa D1.
- Source giữ version Worker RC5.1; P0.8 là version APK. Không thay APK Sunmi V2s.
- Log chạy test và trace JVM nằm trong thư mục audit-evidence của source ZIP.

Màn hình thứ hai: Emulator ⋮ → Displays → Add secondary display → 1280×800 →
Apply Changes; mở app đăng nhập → Màn hình thứ hai → Kết nối lại màn hình khách.
