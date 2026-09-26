# POC → quầy Cloud · Visual QA (chưa đạt cổng phát hành)

- Source visual truth: `LotusPOS_POC_VN_CN_FnB_v10_MEMBER.html` do khách cung cấp; ảnh tham chiếu màn lịch ca trong hội thoại, 1905 × 951 px (gồm thanh trình duyệt).
- Implementation: `public/counter/index.html`, `public/counter/poc-counter.css`, `public/staff/staff.js`.
- Implementation screenshot path: **chưa có**; trình duyệt Cloud từ môi trường này không thể truy cập máy chủ nội bộ (`ERR_BLOCKED_BY_CLIENT`). Không có dịch vụ `sites-preview` khả dụng.
- Viewport/CSS size/density normalization: chưa xác định cho implementation vì không mở được bản render; không tuyên bố so khớp pixel.
- State: POC lịch ca tuần và POS quầy; bản mới chưa có ảnh cùng viewport/trạng thái để so trực tiếp.
- Full-view comparison evidence: **blocked**. Focused-region comparison (sidebar, ô tuần, thẻ món) cũng **blocked** vì thiếu ảnh render.
- Browser-rendered implementation screenshot / console errors / primary browser interactions: **blocked**; `node --test` là kiểm tra logic/DOM, không thay thế thử tương tác cảm ứng và hình ảnh trên trình duyệt.

## Findings

- [P1] Chưa kiểm chứng độ giống POC bằng ảnh song song. Đã đọc HTML/CSS POC, mang màu `#0f172a`, nền `#f4f6f8`, 250 px sidebar, 2 cột bán hàng và lịch tuần 7 × 16 sang quầy, nhưng chưa thể so với ảnh bản build trên cùng viewport. Phải capture bằng trình duyệt quầy và sửa sai khác trước khi coi là hoàn thiện.
- [P1] POC còn các mục ca nâng cao (xin nghỉ, OT, đổi ca, checklist, bàn giao) chỉ mô phỏng localStorage; quầy Cloud chưa có dữ liệu/API D1 cho các mục này. Không đặt nút giả vờ hoạt động trên hệ thống bán thật.
- [P2] Font/typography, nhịp khoảng trắng, sắc màu trạng thái, logo và nội dung song ngữ đã được đối chiếu bằng mã nguồn POC nhưng **chưa đánh giá hình ảnh thực tế**. Cần xem kích thước card, xuống dòng, tương phản và ảnh logo ở máy quầy.
- [P2] Chưa thể xác minh bằng trình duyệt việc cuộn sidebar, ô lịch ngang, chọn món, tìm SKU, lọc danh mục, thao tác chạm và in giấy trên máy thật. 204 kiểm thử tự động qua ở môi trường mô phỏng.

## Open Questions

- Chủ tiệm muốn tái hiện chính xác cả các module demo chưa có backend của POC hay chỉ các màn tương ứng dữ liệu D1 đang vận hành? Yêu cầu hiện tại được hiểu là hướng tới đầy đủ; phần chưa có không được báo là đã triển khai.

## Implementation Checklist

1. Mở bản thử trên máy quầy ở cửa hàng, capture bán hàng/lịch ca và POC ở cùng viewport/trạng thái; đặt hai ảnh trong một bản so sánh.
2. Thử liên tục đường bán QR → quầy, nhập kho → bán không bị chặn, lịch ca → chấm công, và các nút in/két.
3. Chuyển các nghiệp vụ POC còn thiếu sang D1 với quyền và kiểm thử riêng trước khi đưa các điều khiển lên UI.
4. Chỉnh các lệch P0–P2; lặp lại capture và thử console, sau đó mới ghi QA `passed`.

final result: blocked
