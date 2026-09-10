CREATE TABLE `core_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "core_values_active_check" CHECK("core_values"."active" IN (0, 1)),
	CONSTRAINT "core_values_sort_order_check" CHECK("core_values"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_values_name_unique_idx` ON `core_values` ("name" COLLATE NOCASE);