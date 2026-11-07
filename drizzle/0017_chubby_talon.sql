CREATE TABLE `organization_settings` (
	`organizationId` varchar(36) NOT NULL,
	`disabledModules` text,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organization_settings_organizationId` PRIMARY KEY(`organizationId`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`userId` int NOT NULL,
	`designation` varchar(120),
	`department` varchar(120),
	`addressLine` varchar(300),
	`city` varchar(120),
	`district` varchar(120),
	`state` varchar(120),
	`pincode` varchar(10),
	`emergencyContact` varchar(160),
	`photoStorageKey` varchar(240),
	`photoContentType` varchar(64),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `coverAttachmentId` varchar(36);--> statement-breakpoint
ALTER TABLE `sites` ADD `coverAttachmentId` varchar(36);--> statement-breakpoint
ALTER TABLE `organization_settings` ADD CONSTRAINT `organization_settings_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD CONSTRAINT `organization_settings_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;