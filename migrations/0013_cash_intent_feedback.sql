-- Keep a customer's payment choice with the order across all POS screens.
-- Existing orders used the bank QR flow and retain that default.
ALTER TABLE qr_orders ADD COLUMN payment_preference TEXT NOT NULL DEFAULT 'BANK'
 CHECK(payment_preference IN ('BANK','CASH'));

-- Echo Coffee's review form replaces the unused invoice-request QR.
UPDATE pos_store_config SET feedback_url='https://forms.gle/Fpd7b7PdQV9kPBpf7'
 WHERE id=1 AND (feedback_url IS NULL OR feedback_url='');
UPDATE pos_store_config SET invoice_url='' WHERE id=1;
