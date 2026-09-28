# Giới hạn P0.5

1. APK nhắm Android 11/API 30, nhưng chỉ hoạt động đầy đủ khi Cloudflare Worker trung tâm đã chạy API RC5 với D1 migration 0014. Cấu hình URL trong app không triển khai Worker. Domain mặc định là `https://pos-unified.lgl247-ai.workers.dev`; môi trường build hiện tại không kết nối được domain này, nên chưa thử ghi dữ liệu vào D1 thật.
2. Máy ASUS có thể thử overlay display bằng EXE đi kèm. Chưa kiểm chứng màn hình thứ hai, máy in, két trên máy POS vật lý. Overlay giả lập chỉ kiểm luồng Android Presentation.
3. Không có chế độ nhận đơn offline. D1 là nguồn dữ liệu chung; SQLite trên Android chỉ giữ job in và chống in lặp. Mất mạng thì màn hình báo lỗi, đơn QR không được nhận mới.
4. APK debug ký để cài/test và nâng cấp từ bản debug trước; bản release chưa có keystore của chủ tiệm. Không dùng APK unsigned để cài.
5. Trạng thái job `SENT` chỉ xác nhận dữ liệu đã được gửi cho máy in, không xác nhận giấy thực tế. `UNKNOWN` cần kiểm tra giấy trước khi in lại. Hai USB printer cùng VID/PID chưa được phân biệt.
6. Hiện mỗi đơn vị món được in tem khi bật label; chưa có thuộc tính per-product `printLabel`. Két mặc định tắt. Bill tách in hóa đơn khi bill PAID; tem và bếp đợi toàn đơn PAID. POS cầm tay vẫn in hóa đơn bằng máy của nó khi tự xác nhận thanh toán; quầy nhận tem/bếp từ các thanh toán đó để tránh in trùng hóa đơn.
7. Cài đặt phần cứng/thử in thủ công chưa yêu cầu quyền quản lý của Worker. Cần kiểm soát quyền chạm vào máy quầy trong lúc pilot.
