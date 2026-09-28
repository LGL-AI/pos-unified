# Device-local configuration

The hardware screen saves local settings in private Android preferences; no printer IP or USB path is put in D1. Worker/D1 remains authoritative for orders, payments, menu, inventory, members and vouchers.

| Setting | Initial value | Onsite action |
| --- | --- | --- |
| `receiptEnabled` | `true` | Select receipt USB VID/PID and grant permission; it also prints the kitchen ticket |
| `labelEnabled` | `true` | Select label USB VID/PID and test protocol |
| `labelDpi` | `203` provisional | Confirm against manufacturer/test print |
| `labelWidth`, `labelHeight`, `labelGap` | `38`, `40`, `2` mm | Match physical roll; height unconfirmed |
| `labelSpeed` | `5` | Lower if prints slip |
| `kitchenRoute`, `kitchenEnabled` | `RECEIPT_USB`, `true` | Default: kitchen ticket and receipt use the same cutter-equipped USB printer; `LAN` routes the kitchen ticket to KV804 instead |
| `kitchenHost`, `kitchenPort` | empty, `9100` | Only needed for optional `LAN` route; set static/reserved KV804 IP on router |
| `drawerEnabled` | `false` | Enable after wiring test |

Receipt and label selections match VID/PID, not a hard-coded model or USB path. Two identical printers with the same VID/PID cannot yet be distinguished. The default server is the current Worker; **Thiết bị → Máy chủ POS** accepts another compatible RC5 HTTPS origin after a health check. QR links and handheld POS must use the same backend. USB Serial receipt fallback is not implemented in P0.

Example of the onsite values to record **without credentials**:

```json
{"device":"iMin D3-505","receipt":{"vid":null,"pid":null,"protocol":"ESC/POS","widthMm":80},"label":{"vid":null,"pid":null,"protocol":"TSPL-compatible provisional","dpi":203,"widthMm":38,"heightMm":40,"gapMm":2},"kitchen":{"route":"RECEIPT_USB","optionalLanHost":null,"port":9100,"protocol":"ESC/POS"},"drawer":{"enabled":false}}
```
