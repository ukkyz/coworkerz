CREATE TABLE `ceo_persona` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text DEFAULT 'CEO' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`profile` text,
	`analyzed_message_count` integer DEFAULT 0 NOT NULL,
	`provider_mode` text DEFAULT 'opencode-local-runtime' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversation_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`sender_role` text NOT NULL,
	`target_role` text DEFAULT 'ALL' NOT NULL,
	`interaction_mode` text DEFAULT 'walk_and_talk' NOT NULL,
	`room_zone` text DEFAULT 'strategy-table' NOT NULL,
	`content` text NOT NULL,
	`model_used` text DEFAULT 'opencode/deepseek-v4.1-flash-free' NOT NULL,
	`provider_mode` text DEFAULT 'opencode-live' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `deliberation_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deliberation_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ceo_question` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`auto_walk_and_talk` integer DEFAULT true NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`executive_summary` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ek_api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`assigned_role` text DEFAULT 'EXTERNAL_AGENT' NOT NULL,
	`allowed_domains` text DEFAULT '["*"]' NOT NULL,
	`clearance_level` text DEFAULT 'internal' NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`can_read_agent_memory` integer DEFAULT false NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ek_api_keys_key_hash_unique` ON `ek_api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `ek_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`domain_key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`heading` text DEFAULT 'Section' NOT NULL,
	`content` text NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`embedding` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `ek_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ek_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`doc_type` text DEFAULT 'policy' NOT NULL,
	`domain_key` text NOT NULL,
	`secondary_domains` text DEFAULT '[]' NOT NULL,
	`summary` text NOT NULL,
	`content` text NOT NULL,
	`classification_level` text DEFAULT 'internal' NOT NULL,
	`acl_read_roles` text DEFAULT '["CEO","CTO","CFO","COO"]' NOT NULL,
	`acl_write_roles` text DEFAULT '["CEO"]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`taxonomy_concepts` text DEFAULT '[]' NOT NULL,
	`classifier_mode` text DEFAULT 'skos-hybrid-classifier' NOT NULL,
	`review_status` text DEFAULT 'pending_review' NOT NULL,
	`reviewed_by` text,
	`reviewer_notes` text,
	`reviewed_at` integer,
	`embedding` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`domain_key`) REFERENCES `ek_domains`(`key`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ek_documents_slug_unique` ON `ek_documents` (`slug`);--> statement-breakpoint
CREATE TABLE `ek_domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`owner_role` text DEFAULT 'CEO' NOT NULL,
	`color_hex` text DEFAULT '#2563EB' NOT NULL,
	`default_clearance` text DEFAULT 'internal' NOT NULL,
	`acl_read_roles` text DEFAULT '["CEO","CTO","CFO","COO"]' NOT NULL,
	`acl_write_roles` text DEFAULT '["CEO"]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ek_domains_key_unique` ON `ek_domains` (`key`);--> statement-breakpoint
CREATE TABLE `ek_entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_key` text NOT NULL,
	`name` text NOT NULL,
	`entity_type` text DEFAULT 'System' NOT NULL,
	`domain_key` text NOT NULL,
	`taxonomy_concept_id` text,
	`description` text NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`classification_level` text DEFAULT 'internal' NOT NULL,
	`acl_read_roles` text DEFAULT '["CEO","CTO","CFO","COO"]' NOT NULL,
	`source_document_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`domain_key`) REFERENCES `ek_domains`(`key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_document_id`) REFERENCES `ek_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ek_entities_canonical_key_unique` ON `ek_entities` (`canonical_key`);--> statement-breakpoint
CREATE TABLE `ek_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_entity_id` integer NOT NULL,
	`target_entity_id` integer NOT NULL,
	`predicate` text NOT NULL,
	`domain_key` text NOT NULL,
	`is_cross_domain` integer DEFAULT false NOT NULL,
	`weight` integer DEFAULT 85 NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`classification_level` text DEFAULT 'internal' NOT NULL,
	`acl_read_roles` text DEFAULT '["CEO","CTO","CFO","COO"]' NOT NULL,
	`source_document_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`source_entity_id`) REFERENCES `ek_entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_entity_id`) REFERENCES `ek_entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_key`) REFERENCES `ek_domains`(`key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_document_id`) REFERENCES `ek_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ek_taxonomy_schemes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheme_uri` text DEFAULT 'urn:aether:enterprise:taxonomy' NOT NULL,
	`title` text DEFAULT 'Aether Enterprise SKOS/OWL Knowledge Taxonomy' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`format` text DEFAULT 'yaml-skos' NOT NULL,
	`yaml_content` text NOT NULL,
	`skos_turtle` text DEFAULT '' NOT NULL,
	`parsed_concepts` text DEFAULT '[]' NOT NULL,
	`updated_by` text DEFAULT 'CEO' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `executive_memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executive_role` text NOT NULL,
	`session_id` integer,
	`session_question` text,
	`source_message_id` integer,
	`memory_type` text NOT NULL,
	`counterpart_role` text,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `deliberation_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_message_id`) REFERENCES `conversation_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `knowledge_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer,
	`source_message_id` integer,
	`contributor_role` text NOT NULL,
	`collaborator_role` text,
	`topic` text NOT NULL,
	`insight` text NOT NULL,
	`category` text DEFAULT 'cross-functional' NOT NULL,
	`confidence_score` integer DEFAULT 91 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `deliberation_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_message_id`) REFERENCES `conversation_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `opencode_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_url` text DEFAULT 'https://opencode.ai/inference/openai/v1' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`cto_model` text DEFAULT 'opencode/deepseek-v4.1-flash-free' NOT NULL,
	`cfo_model` text DEFAULT 'opencode/mimo-v2.6-flash-free' NOT NULL,
	`coo_model` text DEFAULT 'opencode/nemotron-3.5-lightning-free' NOT NULL,
	`temperature` text DEFAULT '0.65' NOT NULL,
	`walk_talk_rounds` integer DEFAULT 4 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `persona_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`change_summary` text NOT NULL,
	`trigger_event` text NOT NULL,
	`session_id` integer,
	`markdown` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `deliberation_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `seed_runs` (
	`name` text PRIMARY KEY NOT NULL
);
