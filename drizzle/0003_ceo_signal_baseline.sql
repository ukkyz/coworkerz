CREATE TABLE `ceo_signal_baseline` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`persona_version` integer,
	`ceo_messages` integer NOT NULL,
	`readings` text NOT NULL,
	CONSTRAINT "single_ceo_baseline" CHECK("ceo_signal_baseline"."id" = 1)
);
