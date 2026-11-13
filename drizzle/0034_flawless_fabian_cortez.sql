CREATE TABLE `warranties` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`direction` enum('Received','Given') NOT NULL,
	`itemName` varchar(180) NOT NULL,
	`category` varchar(64) NOT NULL,
	`vendorId` varchar(36),
	`partyName` varchar(180),
	`reference` varchar(120),
	`startDate` date NOT NULL,
	`endDate` date NOT NULL,
	`terms` text,
	`contactPhone` varchar(40),
	`status` enum('Active','Closed') NOT NULL DEFAULT 'Active',
	`createdBy` int NOT NULL,
	`clientMutationId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `warranties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warranty_claims` (
	`id` varchar(36) NOT NULL,
	`warrantyId` varchar(36) NOT NULL,
	`claimDate` date NOT NULL,
	`problem` text NOT NULL,
	`status` enum('Open','Resolved','Rejected') NOT NULL DEFAULT 'Open',
	`resolution` text,
	`createdBy` int NOT NULL,
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warranty_claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_vendorId_vendors_id_fk` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warranty_claims` ADD CONSTRAINT `warranty_claims_warrantyId_warranties_id_fk` FOREIGN KEY (`warrantyId`) REFERENCES `warranties`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warranty_claims` ADD CONSTRAINT `warranty_claims_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warranty_claims` ADD CONSTRAINT `warranty_claims_resolvedBy_users_id_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `warranty_site_end_idx` ON `warranties` (`siteId`,`endDate`);--> statement-breakpoint
CREATE INDEX `warranty_org_end_idx` ON `warranties` (`organizationId`,`endDate`);--> statement-breakpoint
CREATE INDEX `warranty_claim_warranty_idx` ON `warranty_claims` (`warrantyId`,`status`);