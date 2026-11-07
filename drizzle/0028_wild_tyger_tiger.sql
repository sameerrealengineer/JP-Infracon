CREATE TABLE `app_reports` (
	`id` varchar(36) NOT NULL,
	`source` enum('worker','pin_reset','staff','app_error') NOT NULL,
	`organizationId` varchar(36),
	`siteId` varchar(36),
	`userId` int,
	`personId` varchar(36),
	`category` varchar(40) NOT NULL,
	`message` varchar(1000),
	`detail` text,
	`screen` varchar(160),
	`appVersion` varchar(32),
	`platform` varchar(16),
	`fingerprint` varchar(255),
	`repeatCount` int NOT NULL DEFAULT 1,
	`status` enum('Open','Resolved') NOT NULL DEFAULT 'Open',
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`resolution` varchar(300),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `app_report_org_status_idx` ON `app_reports` (`organizationId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `app_report_site_status_idx` ON `app_reports` (`siteId`,`status`);--> statement-breakpoint
CREATE INDEX `app_report_fingerprint_idx` ON `app_reports` (`fingerprint`,`lastSeenAt`);