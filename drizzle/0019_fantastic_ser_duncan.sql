CREATE TABLE `alert_rules` (
	`organizationId` varchar(36) NOT NULL,
	`category` varchar(32) NOT NULL,
	`role` varchar(32) NOT NULL,
	`push` enum('Yes','No') NOT NULL DEFAULT 'Yes',
	`whatsapp` enum('Yes','No') NOT NULL DEFAULT 'Yes',
	`sms` enum('Yes','No') NOT NULL DEFAULT 'Yes',
	`detail` enum('full','title') NOT NULL DEFAULT 'full',
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_rule_org_category_role_uq` UNIQUE(`organizationId`,`category`,`role`)
);
--> statement-breakpoint
CREATE TABLE `user_alert_mutes` (
	`userId` int NOT NULL,
	`category` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_alert_mute_uq` UNIQUE(`userId`,`category`)
);
--> statement-breakpoint
ALTER TABLE `alert_rules` ADD CONSTRAINT `alert_rules_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alert_rules` ADD CONSTRAINT `alert_rules_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_alert_mutes` ADD CONSTRAINT `user_alert_mutes_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;