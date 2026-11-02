CREATE TABLE `inventory_movements` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`materialItemId` varchar(36) NOT NULL,
	`movementType` enum('Receipt/Inward','Issue/Consumption','Return to Store','Wastage','Damage') NOT NULL,
	`direction` enum('Inbound','Outbound') NOT NULL,
	`quantity` decimal(14,3) NOT NULL,
	`unitCode` varchar(32) NOT NULL,
	`sourceReference` varchar(180),
	`reason` text NOT NULL,
	`status` enum('Submitted','Posted','Rejected') NOT NULL DEFAULT 'Submitted',
	`createdBy` int NOT NULL,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewNote` text,
	`postedBy` int,
	`postedAt` timestamp,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_movements_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `inventory_move_org_id_uq` UNIQUE(`organizationId`,`id`)
);
--> statement-breakpoint
ALTER TABLE `material_items` ADD `clientMutationId` varchar(64);--> statement-breakpoint
ALTER TABLE `material_items` ADD CONSTRAINT `material_items_clientMutationId_unique` UNIQUE(`clientMutationId`);--> statement-breakpoint
ALTER TABLE `material_items` ADD CONSTRAINT `material_item_org_id_uq` UNIQUE(`organizationId`,`id`);--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_postedBy_users_id_fk` FOREIGN KEY (`postedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_move_site_same_org_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_move_item_same_org_fk` FOREIGN KEY (`organizationId`,`materialItemId`) REFERENCES `material_items`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `inventory_move_site_status_idx` ON `inventory_movements` (`organizationId`,`siteId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `inventory_move_item_balance_idx` ON `inventory_movements` (`organizationId`,`siteId`,`materialItemId`,`status`);