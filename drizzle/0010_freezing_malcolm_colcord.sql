CREATE TABLE `petty_cash_funds` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`nameKey` varchar(120) NOT NULL,
	`custodianUserId` int NOT NULL,
	`custodianNameSnapshot` varchar(180) NOT NULL,
	`authorizedLimitMinor` decimal(18,0) NOT NULL,
	`reconciliationPeriod` enum('Weekly','Fortnightly','Monthly','Quarterly') NOT NULL,
	`status` enum('Pending Custodian','Active','On Hold','Closed') NOT NULL DEFAULT 'Pending Custodian',
	`custodianAcknowledgedBy` int,
	`custodianAcknowledgedAt` timestamp,
	`createdBy` int NOT NULL,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `petty_cash_funds_id` PRIMARY KEY(`id`),
	CONSTRAINT `petty_cash_funds_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `petty_cash_fund_org_id_uq` UNIQUE(`organizationId`,`id`),
	CONSTRAINT `petty_cash_fund_org_site_id_uq` UNIQUE(`organizationId`,`siteId`,`id`),
	CONSTRAINT `petty_cash_fund_site_name_uq` UNIQUE(`organizationId`,`siteId`,`nameKey`)
);
--> statement-breakpoint
CREATE TABLE `petty_cash_movements` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`fundId` varchar(36) NOT NULL,
	`movementType` enum('Funding','Expense','Cash Return') NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`movementDate` date NOT NULL,
	`paymentMode` enum('Cash','UPI','Bank Transfer','Cheque','Card','Other') NOT NULL,
	`payeeName` varchar(180) NOT NULL,
	`paidByName` varchar(180) NOT NULL,
	`sourceAccountLabel` varchar(180) NOT NULL,
	`category` varchar(80) NOT NULL,
	`purpose` text NOT NULL,
	`taskId` varchar(36),
	`relatedMovementId` varchar(36),
	`receiptReference` varchar(160),
	`receiptMissingReason` text,
	`status` enum('Draft','Submitted','Approved','Rejected','Cancelled','Posted') NOT NULL DEFAULT 'Draft',
	`createdBy` int NOT NULL,
	`submittedBy` int,
	`submittedAt` timestamp,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`postedBy` int,
	`postedAt` timestamp,
	`cancelledBy` int,
	`cancelledAt` timestamp,
	`cancellationReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `petty_cash_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `petty_cash_movements_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `petty_cash_movement_org_site_fund_id_uq` UNIQUE(`organizationId`,`siteId`,`fundId`,`id`)
);
--> statement-breakpoint
ALTER TABLE `petty_cash_funds` ADD CONSTRAINT `petty_cash_funds_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_funds` ADD CONSTRAINT `petty_cash_funds_custodianUserId_users_id_fk` FOREIGN KEY (`custodianUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_funds` ADD CONSTRAINT `petty_cash_funds_custodianAcknowledgedBy_users_id_fk` FOREIGN KEY (`custodianAcknowledgedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_funds` ADD CONSTRAINT `petty_cash_funds_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_funds` ADD CONSTRAINT `petty_cash_fund_site_same_org_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD CONSTRAINT `petty_cash_movements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD CONSTRAINT `petty_cash_movements_submittedBy_users_id_fk` FOREIGN KEY (`submittedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD CONSTRAINT `petty_cash_movements_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD CONSTRAINT `petty_cash_movements_postedBy_users_id_fk` FOREIGN KEY (`postedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD CONSTRAINT `petty_cash_movements_cancelledBy_users_id_fk` FOREIGN KEY (`cancelledBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD CONSTRAINT `petty_cash_movement_fund_scope_fk` FOREIGN KEY (`organizationId`,`siteId`,`fundId`) REFERENCES `petty_cash_funds`(`organizationId`,`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD CONSTRAINT `petty_cash_movement_task_scope_fk` FOREIGN KEY (`siteId`,`taskId`) REFERENCES `work_tasks`(`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `petty_cash_movement_fund_status_date_idx` ON `petty_cash_movements` (`organizationId`,`siteId`,`fundId`,`status`,`movementDate`);--> statement-breakpoint
CREATE INDEX `petty_cash_movement_site_status_date_idx` ON `petty_cash_movements` (`organizationId`,`siteId`,`status`,`movementDate`);--> statement-breakpoint
CREATE INDEX `petty_cash_movement_related_idx` ON `petty_cash_movements` (`organizationId`,`siteId`,`fundId`,`relatedMovementId`);