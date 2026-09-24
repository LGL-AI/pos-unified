-- CANCELLED: D1 Console returned incomplete input when the migration bundle was pasted.
-- DO NOT RETRY THE OLD FILE. The following SELECT only lists application tables and triggers.
SELECT type,name FROM sqlite_schema WHERE type IN ('table','trigger') AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY type,name;
