CREATE TABLE `worker_advances` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`entryType` enum('Advance','Repayment') NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	`installmentMinor` decimal(18,0) NOT NULL,
	`entryDate` date NOT NULL,
	`mode` enum('Bank transfer','UPI','Cheque','Cash') NOT NULL,
	`reference` varchar(120),
	`reason` text NOT NULL,
	`status` enum('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `worker_advances_id` PRIMARY KEY(`id`),
	CONSTRAINT `worker_advances_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `worker_advances` ADD CONSTRAINT `worker_advances_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_advances` ADD CONSTRAINT `worker_advances_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_advances` ADD CONSTRAINT `worker_advances_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_advances` ADD CONSTRAINT `worker_advances_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_advances` ADD CONSTRAINT `worker_advances_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `worker_advance_site_person_idx` ON `worker_advances` (`siteId`,`personId`,`status`);