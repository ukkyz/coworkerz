CREATE TABLE `gateway_request_state` (
	`base_url` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gateway_sequence_range" CHECK("gateway_request_state"."last_sequence" BETWEEN 0 AND 9007199254740991)
);
