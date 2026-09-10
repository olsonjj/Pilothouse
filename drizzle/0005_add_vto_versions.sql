CREATE TABLE `vto_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`published_at` text NOT NULL,
	`created_by` integer NOT NULL,
	`core_focus_why` text,
	`core_focus_what` text,
	`ten_year_target` text,
	`ten_year_target_date` text,
	`marketing_target_market` text,
	`marketing_three_uniques` text DEFAULT '[]' NOT NULL,
	`marketing_proven_process` text,
	`marketing_guarantee` text,
	`three_year_date` text,
	`three_year_revenue` integer,
	`three_year_profit` integer,
	`three_year_items` text DEFAULT '[]' NOT NULL,
	`one_year_label` text,
	`one_year_revenue` integer,
	`one_year_profit` integer,
	`one_year_items` text DEFAULT '[]' NOT NULL,
	`one_year_priorities` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vto_versions_money_checks" CHECK(("vto_versions"."three_year_revenue" IS NULL OR ("vto_versions"."three_year_revenue" >= 0 AND "vto_versions"."three_year_revenue" = CAST("vto_versions"."three_year_revenue" AS INTEGER)))
      AND ("vto_versions"."three_year_profit" IS NULL OR ("vto_versions"."three_year_profit" >= 0 AND "vto_versions"."three_year_profit" = CAST("vto_versions"."three_year_profit" AS INTEGER)))
      AND ("vto_versions"."one_year_revenue" IS NULL OR ("vto_versions"."one_year_revenue" >= 0 AND "vto_versions"."one_year_revenue" = CAST("vto_versions"."one_year_revenue" AS INTEGER)))
      AND ("vto_versions"."one_year_profit" IS NULL OR ("vto_versions"."one_year_profit" >= 0 AND "vto_versions"."one_year_profit" = CAST("vto_versions"."one_year_profit" AS INTEGER))))
);
