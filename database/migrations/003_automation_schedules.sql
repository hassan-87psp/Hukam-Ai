-- Optional daily schedules; existing saved automations remain unscheduled.
ALTER TABLE automations ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automations ADD COLUMN schedule_time TEXT;
ALTER TABLE automations ADD COLUMN schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur';
ALTER TABLE automations ADD COLUMN last_scheduled_day TEXT;
CREATE INDEX IF NOT EXISTS idx_automations_schedules ON automations(schedule_enabled, enabled, schedule_time);
