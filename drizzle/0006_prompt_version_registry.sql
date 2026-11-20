CREATE TABLE `executive_prompt_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executive_id` text NOT NULL,
	`version` integer NOT NULL,
	`skill_prompt` text NOT NULL,
	`previous_prompt` text,
	`change_reason` text NOT NULL,
	`actor` text DEFAULT 'CEO' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_version_per_executive` ON `executive_prompt_versions` (`executive_id`,`version`);
--> statement-breakpoint
-- Baseline every existing identity at version 1 so a later edit has something to diff
-- against. This is a backfill of current state, not a rewrite of any prompt text.
INSERT INTO `executive_prompt_versions` (`executive_id`, `version`, `skill_prompt`, `previous_prompt`, `change_reason`, `actor`)
SELECT `executive_id`, 1, `skill_prompt`, NULL, 'migration baseline', 'system' FROM `executive_roster`;
