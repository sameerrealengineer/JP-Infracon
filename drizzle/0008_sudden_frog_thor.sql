CREATE TABLE `auth_sessions` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`identifierHash` varchar(64) NOT NULL,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`windowStartedAt` timestamp NOT NULL DEFAULT (now()),
	`lockedUntil` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `login_attempts_identifierHash` PRIMARY KEY(`identifierHash`)
);
--> statement-breakpoint
CREATE TABLE `system_bootstrap` (
	`bootstrapKey` varchar(64) NOT NULL,
	`completedAt` timestamp,
	`completedByUserId` int,
	CONSTRAINT `system_bootstrap_bootstrapKey` PRIMARY KEY(`bootstrapKey`)
);
--> statement-breakpoint
CREATE TABLE `user_credentials` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`username` varchar(32) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`mustChangePassword` int NOT NULL DEFAULT 0,
	`passwordChangedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_credentials_username_uq` UNIQUE(`username`),
	CONSTRAINT `user_credentials_user_uq` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','super_admin') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `system_bootstrap` ADD CONSTRAINT `system_bootstrap_completedByUserId_users_id_fk` FOREIGN KEY (`completedByUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_credentials` ADD CONSTRAINT `user_credentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auth_sessions_user_expiry_idx` ON `auth_sessions` (`userId`,`expiresAt`);
--> statement-breakpoint
INSERT INTO `system_bootstrap` (`bootstrapKey`, `completedAt`, `completedByUserId`) VALUES ('first_super_admin', NULL, NULL);
