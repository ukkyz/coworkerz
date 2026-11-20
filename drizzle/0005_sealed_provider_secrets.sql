-- Phase 0.5: no usable provider credential may live in the SQLite file.
-- Existing plaintext keys are cleared rather than re-encrypted: the migration must not
-- need the master key, and any key that has already been written to a database file or a
-- backup should be rotated anyway. The operator re-enters it once in OpenCode API settings.
UPDATE `opencode_configs` SET `api_key` = '' WHERE `api_key` <> '' AND `api_key` NOT LIKE 'v1:%';
