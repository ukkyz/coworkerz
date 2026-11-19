CREATE TABLE `executive_profile_overrides` (
	`role` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`job` text NOT NULL,
	`skill_prompt` text NOT NULL,
	CONSTRAINT "executive_profile_role" CHECK("executive_profile_overrides"."role" IN ('CTO', 'CFO', 'COO'))
);
