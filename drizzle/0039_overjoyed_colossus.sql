CREATE TABLE `guarantees` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`tenderId` varchar(36),
	`projectId` varchar(36),
	`kind` varchar(40) NOT NULL,
	`instrument` varchar(40) NOT NULL,
	`bankName` varchar(160),
	`instrumentNumber` varchar(120),
	`beneficiary` varchar(180),
	`amountMinor` decimal(18,0) NOT NULL,
	`issueDate` date NOT NULL,
	`expiryDate` date,
	`claimDate` date,
	`status` enum('Active','Released','Encashed') NOT NULL DEFAULT 'Active',
	`closedOn` date,
	`note` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `guarantees_id` PRIMARY KEY(`id`),
	CONSTRAINT `guarantees_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `tenders` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`nitNumber` varchar(120) NOT NULL,
	`department` varchar(180) NOT NULL,
	`workName` varchar(300) NOT NULL,
	`location` varchar(180),
	`estimateMinor` decimal(18,0),
	`quotedMinor` decimal(18,0),
	`bidDueDate` date,
	`bidOpeningDate` date,
	`bidValidityDate` date,
	`status` enum('Preparing','Submitted','Opened','Won','Lost','Withdrawn','Cancelled') NOT NULL DEFAULT 'Preparing',
	`rank` varchar(20),
	`resultNote` text,
	`projectId` varchar(36),
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenders_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenders_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `tender_org_code_uq` UNIQUE(`organizationId`,`code`)
);
--> statement-breakpoint
CREATE TABLE `time_extensions` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`stipulatedCompletion` date NOT NULL,
	`requestedDays` int NOT NULL,
	`grantedDays` int,
	`basis` text NOT NULL,
	`letterReference` varchar(160),
	`requestDate` date NOT NULL,
	`decisionDate` date,
	`decisionReference` varchar(160),
	`status` enum('Requested','Granted','Rejected') NOT NULL DEFAULT 'Requested',
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `time_extensions_id` PRIMARY KEY(`id`),
	CONSTRAINT `time_extensions_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `guarantees` ADD CONSTRAINT `guarantees_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guarantees` ADD CONSTRAINT `guarantees_tenderId_tenders_id_fk` FOREIGN KEY (`tenderId`) REFERENCES `tenders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guarantees` ADD CONSTRAINT `guarantees_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guarantees` ADD CONSTRAINT `guarantees_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `time_extensions` ADD CONSTRAINT `time_extensions_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `time_extensions` ADD CONSTRAINT `time_extensions_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `time_extensions` ADD CONSTRAINT `time_extensions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `guarantee_org_expiry_idx` ON `guarantees` (`organizationId`,`expiryDate`);