-- Shift operations behind the eight child screens in the original counter POC.
-- Existing orders, products and historical attendance are left intact.
CREATE TABLE pos_supplier_deliveries (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, supplier TEXT NOT NULL,
 po_number TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL, due_time TEXT NOT NULL,
 shift_name TEXT NOT NULL, receiver_id TEXT NOT NULL, items_text TEXT NOT NULL,
 supplier_phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','RECEIVED','CANCELLED')),
 condition_note TEXT NOT NULL DEFAULT '', received_at TEXT, received_by TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_deliveries_due ON pos_supplier_deliveries(due_date,status);

CREATE TABLE pos_leave_requests (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, staff_id TEXT NOT NULL,
 from_date TEXT NOT NULL, to_date TEXT NOT NULL, leave_type TEXT NOT NULL,
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 reviewer_id TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 CHECK(from_date<=to_date)
);
CREATE INDEX idx_leave_staff_days ON pos_leave_requests(staff_id,from_date,to_date,status);

CREATE TABLE pos_shift_tasks (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, work_date TEXT NOT NULL,
 title_vi TEXT NOT NULL, title_zh TEXT NOT NULL, phase TEXT NOT NULL
 CHECK(phase IN ('OPEN','CLEAN','MID','CLOSE')),
 assignee_id TEXT NOT NULL, due_time TEXT NOT NULL, priority TEXT NOT NULL
 CHECK(priority IN ('LOW','NORMAL','HIGH')),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DONE')),
 completed_at TEXT, completed_by TEXT, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_shift_tasks_day ON pos_shift_tasks(work_date,status,phase);

CREATE TABLE pos_ot_requests (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, staff_id TEXT NOT NULL,
 work_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 reviewer_id TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 CHECK(start_time<end_time)
);
CREATE INDEX idx_ot_day ON pos_ot_requests(work_date,staff_id,status);

CREATE TABLE pos_swap_requests (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 schedule_id TEXT NOT NULL, from_staff_id TEXT NOT NULL, to_staff_id TEXT NOT NULL,
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','ACCEPTED','APPROVED','REJECTED','CANCELLED')),
 accepted_at TEXT, reviewer_id TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_swap_schedule ON pos_swap_requests(schedule_id,status);

CREATE TABLE pos_shift_handovers (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, cash_shift_id TEXT,
 from_staff_id TEXT NOT NULL, to_staff_id TEXT NOT NULL,
 pending_work TEXT NOT NULL, stock_note TEXT NOT NULL, equipment_note TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', expected_cash INTEGER,
 created_at TEXT NOT NULL, acknowledged_at TEXT, acknowledged_by TEXT
);
CREATE INDEX idx_handovers_created ON pos_shift_handovers(created_at);

CREATE TABLE pos_attendance_corrections (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, attendance_id TEXT NOT NULL,
 staff_id TEXT NOT NULL, old_clock_in TEXT NOT NULL, old_clock_out TEXT,
 new_clock_in TEXT NOT NULL, new_clock_out TEXT NOT NULL,
 reason TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_attendance_correction ON pos_attendance_corrections(attendance_id,created_at);
CREATE TRIGGER pos_attendance_apply_correction AFTER INSERT ON pos_attendance_corrections BEGIN
 UPDATE pos_attendance SET clock_in=NEW.new_clock_in,clock_out=NEW.new_clock_out,
  status='CLOSED',note='Điều chỉnh: '||NEW.reason
 WHERE id=NEW.attendance_id AND staff_id=NEW.staff_id AND clock_in=NEW.old_clock_in;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'ATTENDANCE_CHANGED') END;
END;

CREATE TRIGGER pos_schedule_no_overlap_update BEFORE UPDATE OF staff_id,work_date,start_time,end_time ON pos_shift_schedules BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pos_shift_schedules s WHERE s.id!=OLD.id AND s.staff_id=NEW.staff_id
  AND s.work_date=NEW.work_date AND s.start_time<NEW.end_time AND s.end_time>NEW.start_time)
 THEN RAISE(ABORT,'SHIFT_OVERLAP') END;
END;
CREATE TRIGGER pos_schedule_leave_guard BEFORE INSERT ON pos_shift_schedules BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pos_leave_requests l WHERE l.staff_id=NEW.staff_id
  AND l.status='APPROVED' AND NEW.work_date BETWEEN l.from_date AND l.to_date)
 THEN RAISE(ABORT,'STAFF_ON_LEAVE') END;
END;
CREATE TRIGGER pos_schedule_leave_guard_update BEFORE UPDATE OF staff_id,work_date ON pos_shift_schedules BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pos_leave_requests l WHERE l.staff_id=NEW.staff_id
  AND l.status='APPROVED' AND NEW.work_date BETWEEN l.from_date AND l.to_date)
 THEN RAISE(ABORT,'STAFF_ON_LEAVE') END;
END;
CREATE TRIGGER pos_leave_approval_guard BEFORE UPDATE OF status ON pos_leave_requests
WHEN NEW.status='APPROVED' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pos_shift_schedules s WHERE s.staff_id=NEW.staff_id
  AND s.work_date BETWEEN NEW.from_date AND NEW.to_date)
 THEN RAISE(ABORT,'LEAVE_SCHEDULE_CONFLICT') END;
END;
CREATE TRIGGER pos_swap_apply AFTER UPDATE OF status ON pos_swap_requests
WHEN OLD.status='ACCEPTED' AND NEW.status='APPROVED' BEGIN
 UPDATE pos_shift_schedules SET staff_id=NEW.to_staff_id
 WHERE id=NEW.schedule_id AND staff_id=NEW.from_staff_id AND work_date>=date('now','+7 hours');
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'SWAP_STALE') END;
END;
