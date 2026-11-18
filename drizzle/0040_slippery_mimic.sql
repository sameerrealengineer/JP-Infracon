CREATE TABLE `dept_measurements` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`contractItemId` varchar(36) NOT NULL,
	`measuredOn` date NOT NULL,
	`location` varchar(200) NOT NULL,
	`nos` varchar(20),
	`length` varchar(20),
	`breadth` varchar(20),
	`depth` varchar(20),
	`deduction` enum('Yes','No') NOT NULL DEFAULT 'No',
	`quantityThousandths` decimal(18,0) NOT NULL,
	`status` enum('Recorded','Signed','Rejected') NOT NULL DEFAULT 'Recorded',
	`mbReference` varchar(80),
	`signedByName` varchar(180),
	`signedByDesignation` varchar(120),
	`signedOn` date,
	`rejectReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`signedRecordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dept_measurements_id` PRIMARY KEY(`id`),
	CONSTRAINT `dept_measurements_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `dept_measurements` ADD CONSTRAINT `dept_measurements_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dept_measurements` ADD CONSTRAINT `dept_measurements_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dept_measurements` ADD CONSTRAINT `dept_measurements_contractItemId_contract_items_id_fk` FOREIGN KEY (`contractItemId`) REFERENCES `contract_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dept_measurements` ADD CONSTRAINT `dept_measurements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dept_measurements` ADD CONSTRAINT `dept_measurements_signedRecordedBy_users_id_fk` FOREIGN KEY (`signedRecordedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dept_mb_project_item_idx` ON `dept_measurements` (`projectId`,`contractItemId`);