CREATE TABLE `equipment` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(160) NOT NULL,
	`equipmentType` varchar(60) NOT NULL,
	`registrationNumber` varchar(40),
	`ownership` enum('Owned','Hired') NOT NULL,
	`ownerName` varchar(180),
	`hireBasis` enum('Hour','Day','Month'),
	`hireRateMinor` decimal(18,0),
	`hireFrom` date,
	`hireTo` date,
	`fuelNormThousandths` decimal(18,0),
	`serviceIntervalHours` int,
	`lastServiceMeterThousandths` decimal(18,0),
	`siteId` varchar(36),
	`status` enum('Working','Idle','Breakdown','Off-hired','Disposed') NOT NULL DEFAULT 'Working',
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `equipment_id` PRIMARY KEY(`id`),
	CONSTRAINT `equipment_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `equipment_org_code_uq` UNIQUE(`organizationId`,`code`)
);
--> statement-breakpoint
CREATE TABLE `equipment_logs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`equipmentId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`logDate` date NOT NULL,
	`startMeterThousandths` decimal(18,0) NOT NULL,
	`endMeterThousandths` decimal(18,0) NOT NULL,
	`idleThousandths` decimal(18,0) NOT NULL,
	`fuelThousandths` decimal(18,0) NOT NULL,
	`operatorName` varchar(160),
	`workDone` varchar(300),
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `equipment_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `equipment_logs_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `equipment_log_day_uq` UNIQUE(`equipmentId`,`logDate`)
);
--> statement-breakpoint
ALTER TABLE `equipment` ADD CONSTRAINT `equipment_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `equipment` ADD CONSTRAINT `equipment_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `equipment` ADD CONSTRAINT `equipment_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `equipment_logs` ADD CONSTRAINT `equipment_logs_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `equipment_logs` ADD CONSTRAINT `equipment_logs_equipmentId_equipment_id_fk` FOREIGN KEY (`equipmentId`) REFERENCES `equipment`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `equipment_logs` ADD CONSTRAINT `equipment_logs_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `equipment_logs` ADD CONSTRAINT `equipment_logs_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;