CREATE TABLE `hindrances` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`code` varchar(40) NOT NULL,
	`category` varchar(40) NOT NULL,
	`description` text NOT NULL,
	`startDate` date NOT NULL,
	`endDate` date,
	`affectsWork` enum('Full stop','Partial') NOT NULL DEFAULT 'Full stop',
	`letterReference` varchar(160),
	`letterDate` date,
	`status` enum('Open','Closed') NOT NULL DEFAULT 'Open',
	`closeNote` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`closedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `hindrances_id` PRIMARY KEY(`id`),
	CONSTRAINT `hindrances_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `hindrance_site_code_uq` UNIQUE(`siteId`,`code`)
);
--> statement-breakpoint
CREATE TABLE `site_diary_notes` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`noteDate` date NOT NULL,
	`kind` enum('Visitor','Instruction','Meeting','Weather','General') NOT NULL,
	`personName` varchar(180),
	`personRole` varchar(120),
	`text` text NOT NULL,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `site_diary_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_diary_notes_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `hindrances` ADD CONSTRAINT `hindrances_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `hindrances` ADD CONSTRAINT `hindrances_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `hindrances` ADD CONSTRAINT `hindrances_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `hindrances` ADD CONSTRAINT `hindrances_closedBy_users_id_fk` FOREIGN KEY (`closedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_diary_notes` ADD CONSTRAINT `site_diary_notes_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_diary_notes` ADD CONSTRAINT `site_diary_notes_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_diary_notes` ADD CONSTRAINT `site_diary_notes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `hindrance_site_start_idx` ON `hindrances` (`siteId`,`startDate`);--> statement-breakpoint
CREATE INDEX `diary_note_site_date_idx` ON `site_diary_notes` (`siteId`,`noteDate`);