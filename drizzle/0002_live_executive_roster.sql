CREATE TABLE `executive_roster` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executive_id` text NOT NULL,
	`role_name` text NOT NULL,
	`title_key` text NOT NULL,
	`display_name` text NOT NULL,
	`job` text NOT NULL,
	`skill_prompt` text NOT NULL,
	`model` text NOT NULL,
	`preset` text NOT NULL,
	`joined_after_message` integer DEFAULT 0 NOT NULL,
	`retired_after_message` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `executive_roster_executive_id_unique` ON `executive_roster` (`executive_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `active_executive_title` ON `executive_roster` (`title_key`) WHERE "executive_roster"."retired_after_message" is null;
--> statement-breakpoint
INSERT INTO executive_roster (executive_id, role_name, title_key, display_name, job, skill_prompt, model, preset)
VALUES ('CTO', 'CTO', 'cto',
  coalesce((select display_name from executive_profile_overrides where role = 'CTO'), 'Dr. Elena Vance'),
  coalesce((select job from executive_profile_overrides where role = 'CTO'), 'Chief Technology Officer'),
  coalesce((select skill_prompt from executive_profile_overrides where role = 'CTO'), 'Distributed AI infrastructure, sovereign model architecture, engineering velocity & cybersecurity.
Focus on: AI & Cloud Architecture, R&D Velocity, Security & Latency, Technical Debt.'),
  coalesce((select cto_model from opencode_configs order by id limit 1), 'opencode/deepseek-v4.1-flash-free'), 'legacy');

--> statement-breakpoint
INSERT INTO executive_roster (executive_id, role_name, title_key, display_name, job, skill_prompt, model, preset)
VALUES ('CFO', 'CFO', 'cfo',
  coalesce((select display_name from executive_profile_overrides where role = 'CFO'), 'Marcus Sterling'),
  coalesce((select job from executive_profile_overrides where role = 'CFO'), 'Chief Financial Officer'),
  coalesce((select skill_prompt from executive_profile_overrides where role = 'CFO'), 'Capital allocation, EBITDA expansion, unit economics, ARR retention & downside risk governance.
Focus on: Capital Efficiency, Unit Economics & ROI, Gross Margin, Scenario Modeling.'),
  coalesce((select cfo_model from opencode_configs order by id limit 1), 'opencode/mimo-v2.6-flash-free'), 'legacy');

--> statement-breakpoint
INSERT INTO executive_roster (executive_id, role_name, title_key, display_name, job, skill_prompt, model, preset)
VALUES ('COO', 'COO', 'coo',
  coalesce((select display_name from executive_profile_overrides where role = 'COO'), 'Sophia Alverez'),
  coalesce((select job from executive_profile_overrides where role = 'COO'), 'Chief Operating Officer'),
  coalesce((select skill_prompt from executive_profile_overrides where role = 'COO'), 'Global execution, enterprise GTM delivery, organizational scaling, vendor SLAs & regional compliance.
Focus on: Operational Readiness, Supply & SLA Execution, Org Capacity, Cross-Regional Rollout.'),
  coalesce((select coo_model from opencode_configs order by id limit 1), 'opencode/nemotron-3.5-lightning-free'), 'legacy');
