-- Departments and Employee Types sections removed from Master Data (user request) — drop the
-- now-unused tables. Neither was wired into staff records anywhere else, so this is safe.
DROP TABLE IF EXISTS "departments";
DROP TABLE IF EXISTS "employee_types";
