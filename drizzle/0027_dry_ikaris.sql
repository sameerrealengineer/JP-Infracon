CREATE TABLE `worker_accounts` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`mobile` varchar(15) NOT NULL,
	`pinHash` varchar(255) NOT NULL,
	`features` text,
	`status` enum('Active','Disabled') NOT NULL DEFAULT 'Active',
	`failedAttempts` int NOT NULL DEFAULT 0,
	`lockedUntil` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `worker_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `worker_accounts_personId_unique` UNIQUE(`personId`),
	CONSTRAINT `worker_accounts_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `worker_accounts_mobile_unique` UNIQUE(`mobile`)
);
--> statement-breakpoint
ALTER TABLE `worker_accounts` ADD CONSTRAINT `worker_accounts_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_accounts` ADD CONSTRAINT `worker_accounts_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_accounts` ADD CONSTRAINT `worker_accounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_accounts` ADD CONSTRAINT `worker_accounts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;