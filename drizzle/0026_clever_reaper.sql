CREATE TABLE `presence_tracking_status` (
	`userId` int NOT NULL,
	`enabled` enum('Yes','No') NOT NULL,
	`fenceCount` int NOT NULL,
	`platform` varchar(20),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `presence_tracking_status_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `site_presence_settings` (
	`siteId` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`workStart` varchar(5) NOT NULL,
	`workEnd` varchar(5) NOT NULL,
	`workDays` varchar(20) NOT NULL,
	`alertOnLeave` enum('Yes','No') NOT NULL DEFAULT 'Yes',
	`alertOnArrive` enum('Yes','No') NOT NULL DEFAULT 'No',
	`recipientUserIds` text,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_presence_settings_siteId` PRIMARY KEY(`siteId`)
);
--> statement-breakpoint
ALTER TABLE `presence_tracking_status` ADD CONSTRAINT `presence_tracking_status_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_presence_settings` ADD CONSTRAINT `site_presence_settings_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_presence_settings` ADD CONSTRAINT `site_presence_settings_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_presence_settings` ADD CONSTRAINT `site_presence_settings_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;